/**
 * 联机房间 API 路由。
 *
 * 房间状态整体序列化存放在 D1 中，并通过 version 字段做乐观并发控制。
 * GET 返回当前玩家可见的房间快照；POST 负责建房和加入；PATCH 负责
 * 选牌、舍牌、放弃荣和及荣和。敏感的对手手牌和房间凭证不会直接暴露。
 */
import {
  createRoomRecord,
  ensureRoomsTable,
  readRoom,
  readRoomPresence,
  saveRoom,
  touchRoomPresence,
} from '../../../db/rooms';
import { ensureAuthTables, getSessionUser } from '../../../db/auth';
import { env } from 'cloudflare:workers';
import { GAME_PROTOCOL_VERSION } from '../../../lib/contracts/protocol';
import type { GameResult, RoomSnapshot, ScoreResult, Seat } from '../../../lib/contracts/mahjong';
import type { MatchEventInput } from '../../../lib/history/events';
import { isFuriten } from '../../../lib/rules/furiten';
import { evaluateWin } from '../../../lib/rules/scoring';
import { suggestTenpaiHand } from '../../../lib/rules/selection';
import { createWall, tileType } from '../../../lib/rules/tiles';
import { waitTypes } from '../../../lib/rules/hand';
import {
  enforceRateLimit,
  parseJsonObject,
  requireSameOrigin,
  secureRandomIndex,
} from '../../../lib/security';

interface RoomState {
  code: string;
  tokens: [string, string | null];
  userIds: [string, string | null];
  pools: [number[], number[]];
  hands: [number[] | null, number[] | null];
  reserves: [number[], number[]];
  discards: [number[], number[]];
  counts: [number, number];
  temporaryFuriten: [boolean, boolean];
  indicator: number;
  uraIndicator: number;
  baseScore: number;
  turn: Seat;
  pendingRon: Seat | null;
  pendingScore: ScoreResult | null;
  lastDiscard: { seat: Seat; tile: number } | null;
  result: GameResult | null;
  version: number;
  recentActionIds?: [string[], string[]];
  turnDeadlineAt?: number | null;
}

const TURN_TIMEOUT_MS = 60_000;
const DISCONNECT_GRACE_MS = 90_000;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = () =>
  Array.from({ length: 6 }, () => CODE_CHARS[secureRandomIndex(CODE_CHARS.length)]).join('');
const token = () => crypto.randomUUID().replaceAll('-', '');

function serviceGate(request: Request): Response | null {
  const runtimeEnv = env as typeof env & {
    MAINTENANCE_MODE?: string;
    MIN_GAME_PROTOCOL?: string;
  };
  if (runtimeEnv.MAINTENANCE_MODE === 'true')
    return Response.json(
      { error: '联机服务正在维护，请稍后再试', code: 'MAINTENANCE' },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '300' } },
    );

  const minimumProtocol = Number(runtimeEnv.MIN_GAME_PROTOCOL ?? GAME_PROTOCOL_VERSION);
  const requestedProtocol = Number(request.headers.get('X-Game-Protocol') ?? 1);
  if (
    !Number.isSafeInteger(minimumProtocol) ||
    !Number.isSafeInteger(requestedProtocol) ||
    requestedProtocol < minimumProtocol ||
    requestedProtocol > GAME_PROTOCOL_VERSION
  )
    return Response.json(
      {
        error: '此牌局需要更新后的客户端，请刷新页面后重新连接。',
        code: 'CLIENT_UPDATE_REQUIRED',
        minimumProtocol,
      },
      {
        status: 426,
        headers: {
          'Cache-Control': 'no-store',
          'X-Min-Game-Protocol': String(minimumProtocol),
        },
      },
    );
  return null;
}

function phase(room: RoomState) {
  if (!room.tokens[1]) return 'waiting' as const;
  if (room.result) return 'finished' as const;
  if (!room.hands[0] || !room.hands[1]) return 'selecting' as const;
  return 'playing' as const;
}

function seatFor(room: RoomState, candidate: string) {
  if (room.tokens[0] === candidate) return 0 as const;
  if (room.tokens[1] === candidate) return 1 as const;
  return null;
}

function publicRoom(room: RoomState, seat: Seat): RoomSnapshot {
  const currentPhase = phase(room);
  const ownHand = room.hands[seat];
  return {
    code: room.code,
    phase: currentPhase,
    seat,
    opponentJoined: Boolean(room.tokens[1]),
    opponentReady: Boolean(room.hands[(1 - seat) as Seat]),
    ownReady: Boolean(ownHand),
    ownPool:
      currentPhase === 'waiting' || currentPhase === 'selecting' ? room.pools[seat] : undefined,
    ownHand: ownHand ?? undefined,
    indicator: room.indicator,
    baseScore: room.baseScore,
    turn: room.turn,
    discards: room.discards,
    counts: room.counts,
    reserveCounts: [21 - room.counts[0], 21 - room.counts[1]],
    ownRemaining:
      currentPhase === 'playing' && room.counts[seat] < 17 ? room.reserves[seat] : undefined,
    pendingRon: room.pendingRon,
    canRon: room.pendingRon === seat,
    pendingScore: room.pendingRon === seat ? room.pendingScore : null,
    temporaryFuriten: room.temporaryFuriten[seat],
    permanentFuriten: ownHand ? isFuriten(ownHand, room.discards[seat], false) : false,
    lastDiscard: room.lastDiscard,
    result: room.result,
    version: room.version,
    turnDeadlineAt: room.turnDeadlineAt ?? null,
  };
}

async function settleExpiredRoom(code: string, room: RoomState, now = Date.now()) {
  if (phase(room) !== 'playing' || room.result) return room;
  const expectedVersion = room.version;
  const lastSeenAt = await readRoomPresence(code);
  let result: GameResult | null = null;
  let presenceGuards: { seat: Seat; lastSeenAt: number | null }[] = [];

  if (room.turnDeadlineAt && room.turnDeadlineAt <= now) {
    const loser = room.pendingRon ?? room.turn;
    result = { kind: 'forfeit', winner: (1 - loser) as Seat, loser, reason: 'turn-timeout' };
  } else {
    const disconnected = ([0, 1] as const).filter(
      (seat) => lastSeenAt[seat] === null || now - lastSeenAt[seat]! >= DISCONNECT_GRACE_MS,
    );
    if (disconnected.length === 2) {
      result = { kind: 'draw', reason: 'both-disconnected' };
      presenceGuards = disconnected.map((seat) => ({ seat, lastSeenAt: lastSeenAt[seat] }));
    } else if (disconnected.length === 1) {
      const [loser] = disconnected;
      result = { kind: 'forfeit', winner: (1 - loser) as Seat, loser, reason: 'disconnect' };
      presenceGuards = [{ seat: loser, lastSeenAt: lastSeenAt[loser] }];
    }
  }

  if (!result) {
    // Lazily start a deadline for live rooms created by the previous protocol.
    if (room.turnDeadlineAt == null) {
      room.turnDeadlineAt = now + TURN_TIMEOUT_MS;
      room.version += 1;
      const event: MatchEventInput = {
        type: 'turn.deadline.started',
        seat: room.pendingRon ?? room.turn,
        stateVersion: room.version,
        createdAt: now,
        payload: { turnDeadlineAt: room.turnDeadlineAt },
      };
      if (!(await saveRoom(code, room, expectedVersion, { events: [event] })))
        return (await readRoom<RoomState>(code)) ?? room;
    }
    return room;
  }
  room.result = result;
  room.pendingRon = null;
  room.pendingScore = null;
  room.turnDeadlineAt = null;
  room.version += 1;
  const event: MatchEventInput =
    result.kind === 'draw'
      ? {
          type: 'hand.drawn',
          seat: null,
          stateVersion: room.version,
          createdAt: now,
          payload: { reason: 'both-disconnected' },
        }
      : {
          type: 'player.forfeited',
          seat: result.loser,
          stateVersion: room.version,
          createdAt: now,
          payload: { winner: result.winner, reason: result.reason },
        };
  if (
    !(await saveRoom(code, room, expectedVersion, {
      events: [event],
      expectedPresence: presenceGuards,
    }))
  )
    return (await readRoom<RoomState>(code)) ?? room;
  return room;
}

function makeRoom(baseScore: number, userId: string): RoomState {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const wall = createWall(Math.random);
    const pools: [number[], number[]] = [wall.slice(0, 34), wall.slice(34, 68)];
    const indicator = tileType(wall[68]);
    if (
      !suggestTenpaiHand(pools[0], indicator, 'east') ||
      !suggestTenpaiHand(pools[1], indicator, 'west')
    )
      continue;
    return {
      code: randomCode(),
      tokens: [token(), null],
      userIds: [userId, null],
      pools,
      hands: [null, null],
      reserves: [[], []],
      discards: [[], []],
      counts: [0, 0],
      temporaryFuriten: [false, false],
      indicator,
      uraIndicator: tileType(wall[69]),
      baseScore,
      turn: 0,
      pendingRon: null,
      pendingScore: null,
      lastDiscard: null,
      result: null,
      version: 1,
      recentActionIds: [[], []],
      turnDeadlineAt: null,
    };
  }
  throw new Error('牌桌生成失败，请重试');
}

async function loadAuthorized(code: string, candidate: string, userId: string) {
  const room = await readRoom<RoomState>(code);
  if (!room) return { error: '房间不存在或已经过期', status: 404 } as const;
  const seat = seatFor(room, candidate);
  if (seat === null) return { error: '房间凭证无效', status: 403 } as const;
  if (room.userIds?.[seat] !== userId)
    return { error: '这个房间不属于当前账号', status: 403 } as const;
  return { room, seat } as const;
}

export async function GET(request: Request) {
  try {
    const gate = serviceGate(request);
    if (gate) return gate;
    await ensureRoomsTable();
    await ensureAuthTables();
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: '请先登录后再进入联机房间' }, { status: 401 });
    const url = new URL(request.url);
    const loaded = await loadAuthorized(
      (url.searchParams.get('code') ?? '').toUpperCase(),
      url.searchParams.get('token') ?? '',
      user.id,
    );
    if ('error' in loaded) return Response.json({ error: loaded.error }, { status: loaded.status });
    const room = await settleExpiredRoom(loaded.room.code, loaded.room);
    if (Number(request.headers.get('X-Game-Protocol') ?? 1) < 2 && phase(room) !== 'finished')
      await touchRoomPresence(loaded.room.code, loaded.seat, Date.now(), 10_000);
    return Response.json(publicRoom(room, loaded.seat), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '房间读取失败' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const gate = serviceGate(request);
    if (gate) return gate;
    requireSameOrigin(request);
    enforceRateLimit(request, 'rooms', 20);
    await ensureRoomsTable();
    await ensureAuthTables();
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: '请先登录后再进行联机对战' }, { status: 401 });
    const body = await parseJsonObject(request);
    const action = typeof body.action === 'string' ? body.action : '';
    if (action === 'heartbeat') {
      const code = (typeof body.code === 'string' ? body.code : '').toUpperCase();
      const loaded = await loadAuthorized(
        code,
        typeof body.token === 'string' ? body.token : '',
        user.id,
      );
      if ('error' in loaded)
        return Response.json({ error: loaded.error }, { status: loaded.status });
      const room = await settleExpiredRoom(code, loaded.room);
      if (phase(room) !== 'finished') await touchRoomPresence(code, loaded.seat);
      return Response.json(publicRoom(room, loaded.seat), {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    if (action === 'create') {
      const allowedScores = new Set([1000, 5000, 10000]);
      const room = makeRoom(
        allowedScores.has(body.baseScore as number) ? (body.baseScore as number) : 5000,
        user.id,
      );
      while (await readRoom(room.code)) room.code = randomCode();
      await createRoomRecord(room.code, room);
      await touchRoomPresence(room.code, 0);
      return Response.json({ code: room.code, token: room.tokens[0] }, { status: 201 });
    }
    if (action === 'join') {
      const code = (typeof body.code === 'string' ? body.code : '').trim().toUpperCase();
      const room = await readRoom<RoomState>(code);
      if (!room) return Response.json({ error: '没有找到这个房间' }, { status: 404 });
      if (room.tokens[1]) return Response.json({ error: '房间已经坐满' }, { status: 409 });
      if (room.userIds?.[0] === user.id)
        return Response.json({ error: '不能加入自己创建的房间' }, { status: 409 });
      const expectedVersion = room.version;
      room.tokens[1] = token();
      room.userIds[1] = user.id;
      room.version += 1;
      const event: MatchEventInput = {
        type: 'player.joined',
        seat: 1,
        stateVersion: room.version,
        createdAt: Date.now(),
        payload: {},
      };
      if (
        !(await saveRoom(code, room, expectedVersion, { events: [event], joinedUserId: user.id }))
      )
        return Response.json({ error: '房间状态刚刚变化，请重试' }, { status: 409 });
      await touchRoomPresence(code, 1);
      return Response.json({ code, token: room.tokens[1] });
    }
    return Response.json({ error: '未知的房间操作' }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '房间操作失败' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const gate = serviceGate(request);
    if (gate) return gate;
    requireSameOrigin(request);
    enforceRateLimit(request, 'game', 60);
    await ensureRoomsTable();
    await ensureAuthTables();
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: '登录状态已经失效，请重新登录' }, { status: 401 });
    const body = await parseJsonObject(request);
    const code = (typeof body.code === 'string' ? body.code : '').toUpperCase();
    const loaded = await loadAuthorized(
      code,
      typeof body.token === 'string' ? body.token : '',
      user.id,
    );
    if ('error' in loaded) return Response.json({ error: loaded.error }, { status: loaded.status });
    const { seat } = loaded;
    const room = await settleExpiredRoom(loaded.room.code, loaded.room);
    if (phase(room) === 'finished')
      return Response.json(
        { error: '牌局已经结束或操作时间已过', snapshot: publicRoom(room, seat) },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      );
    const expectedVersion = room.version;
    const eventVersion = expectedVersion + 1;
    const eventTime = Date.now();
    const events: MatchEventInput[] = [];
    const clientProtocol = Number(request.headers.get('X-Game-Protocol') ?? 1);
    const requiresIdempotency = clientProtocol >= 2;
    const actionId = typeof body.actionId === 'string' ? body.actionId : '';
    if (requiresIdempotency && !/^[a-zA-Z0-9-]{16,64}$/.test(actionId))
      return Response.json({ error: '操作编号无效，请刷新后重试' }, { status: 400 });
    const recentActionIds = room.recentActionIds ?? [[], []];
    if (actionId && recentActionIds[seat].includes(actionId))
      return Response.json(publicRoom(room, seat), { headers: { 'Cache-Control': 'no-store' } });
    if (
      requiresIdempotency &&
      (!Number.isSafeInteger(body.version) || body.version !== expectedVersion)
    )
      return Response.json(
        { error: '牌局状态已更新，请同步后重试', snapshot: publicRoom(room, seat) },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      );

    const currentPhase = phase(room);
    if (currentPhase === 'finished')
      return Response.json({ error: '本局已经结束' }, { status: 409 });

    if (body.action === 'select') {
      if (currentPhase !== 'waiting' && currentPhase !== 'selecting')
        return Response.json({ error: '当前阶段不能选牌' }, { status: 409 });
      if (room.hands[seat]) return Response.json({ error: '手牌已经确认' }, { status: 409 });
      const selected =
        Array.isArray(body.selected) && body.selected.every((value) => Number.isInteger(value))
          ? (body.selected as number[])
          : [];
      const unique = new Set(selected);
      const poolSet = new Set(room.pools[seat]);
      if (selected.length !== 13 || unique.size !== 13 || selected.some((id) => !poolSet.has(id)))
        return Response.json({ error: '请选择牌池内不重复的 13 张牌' }, { status: 400 });
      const hand = selected.map(tileType).sort((a, b) => a - b);
      if (!waitTypes(hand).length)
        return Response.json({ error: '这副手牌尚未听牌' }, { status: 400 });
      room.hands[seat] = hand;
      room.reserves[seat] = room.pools[seat]
        .filter((id) => !unique.has(id))
        .sort((left, right) => tileType(left) - tileType(right) || left - right);
      if (room.hands[0] && room.hands[1]) room.turnDeadlineAt = Date.now() + TURN_TIMEOUT_MS;
      events.push({
        type: 'hand.selected',
        seat,
        stateVersion: eventVersion,
        createdAt: eventTime,
        payload: { selectedIds: selected.slice(), turnDeadlineAt: room.turnDeadlineAt ?? null },
      });
    } else if (body.action === 'discard') {
      if (
        phase(room) !== 'playing' ||
        room.turn !== seat ||
        room.pendingRon !== null ||
        room.counts[seat] >= 17
      )
        return Response.json({ error: '现在不能舍牌' }, { status: 409 });
      const tileId = typeof body.tileId === 'number' ? body.tileId : -1;
      const tileIndex = room.reserves[seat].indexOf(tileId);
      if (tileIndex < 0)
        return Response.json({ error: '请选择自己剩余 21 张牌中的一张' }, { status: 400 });
      const [physicalTile] = room.reserves[seat].splice(tileIndex, 1);
      const tile = tileType(physicalTile);
      const opponent = (1 - seat) as Seat;
      room.counts[seat] += 1;
      room.discards[seat].push(tile);
      room.temporaryFuriten[seat] = false;
      room.lastDiscard = { seat, tile };
      const opponentHand = room.hands[opponent]!;
      const score = evaluateWin(
        opponentHand,
        tile,
        room.indicator,
        opponent === 0 ? 'east' : 'west',
        room.uraIndicator,
      );
      if (
        score?.tier &&
        !isFuriten(opponentHand, room.discards[opponent], room.temporaryFuriten[opponent])
      ) {
        room.pendingRon = opponent;
        room.pendingScore = score;
        room.turnDeadlineAt = Date.now() + TURN_TIMEOUT_MS;
      } else if (room.counts[0] >= 17 && room.counts[1] >= 17) {
        room.result = { kind: 'draw' };
        room.turnDeadlineAt = null;
      } else {
        room.turn = opponent;
        room.turnDeadlineAt = Date.now() + TURN_TIMEOUT_MS;
      }
      events.push({
        type: 'tile.discarded',
        seat,
        stateVersion: eventVersion,
        createdAt: eventTime,
        payload: { physicalTileId: tileId, turnDeadlineAt: room.turnDeadlineAt ?? null },
      });
      if (room.result?.kind === 'draw')
        events.push({
          type: 'hand.drawn',
          seat: null,
          stateVersion: eventVersion,
          createdAt: eventTime,
          payload: { reason: 'seventeen-discard' },
        });
    } else if (body.action === 'pass') {
      if (room.pendingRon !== seat)
        return Response.json({ error: '没有可放弃的荣和机会' }, { status: 409 });
      room.temporaryFuriten[seat] = true;
      room.pendingRon = null;
      room.pendingScore = null;
      if (room.counts[0] >= 17 && room.counts[1] >= 17) room.result = { kind: 'draw' };
      else room.turn = seat;
      room.turnDeadlineAt = room.result ? null : Date.now() + TURN_TIMEOUT_MS;
      events.push({
        type: 'ron.declined',
        seat,
        stateVersion: eventVersion,
        createdAt: eventTime,
        payload: { turnDeadlineAt: room.turnDeadlineAt ?? null },
      });
      if (room.result?.kind === 'draw')
        events.push({
          type: 'hand.drawn',
          seat: null,
          stateVersion: eventVersion,
          createdAt: eventTime,
          payload: { reason: 'seventeen-discard' },
        });
    } else if (body.action === 'ron') {
      if (room.pendingRon !== seat || !room.pendingScore)
        return Response.json({ error: '现在不能荣和' }, { status: 409 });
      room.result = {
        kind: 'ron',
        winner: seat,
        score: room.pendingScore,
        payment: Math.round(room.baseScore * room.pendingScore.multiplier),
        winnerHand: room.hands[seat] ?? undefined,
        uraIndicator: room.uraIndicator,
      };
      room.turnDeadlineAt = null;
      events.push({
        type: 'ron.claimed',
        seat,
        stateVersion: eventVersion,
        createdAt: eventTime,
        payload: {},
      });
    } else if (body.action === 'surrender') {
      if (!room.tokens[1] || (currentPhase !== 'selecting' && currentPhase !== 'playing'))
        return Response.json({ error: '当前阶段不能认输' }, { status: 409 });
      room.result = {
        kind: 'forfeit',
        winner: (1 - seat) as Seat,
        loser: seat,
        reason: 'resigned',
      };
      room.pendingRon = null;
      room.pendingScore = null;
      room.turnDeadlineAt = null;
      events.push({
        type: 'player.forfeited',
        seat,
        stateVersion: eventVersion,
        createdAt: eventTime,
        payload: { winner: (1 - seat) as Seat, reason: 'resigned' },
      });
    } else return Response.json({ error: '未知的对局操作' }, { status: 400 });

    if (actionId) {
      recentActionIds[seat] = [...recentActionIds[seat], actionId].slice(-64);
      room.recentActionIds = recentActionIds;
    }
    room.version += 1;
    if (!(await saveRoom(code, room, expectedVersion, { events })))
      return Response.json({ error: '对局状态刚刚变化，请重试' }, { status: 409 });
    await touchRoomPresence(code, seat);
    return Response.json(publicRoom(room, seat));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '对局操作失败' },
      { status: 500 },
    );
  }
}
