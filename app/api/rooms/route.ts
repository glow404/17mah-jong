/**
 * 联机房间 API 路由。
 *
 * 房间状态整体序列化存放在 D1 中，并通过 version 字段做乐观并发控制。
 * GET 返回当前玩家可见的房间快照；POST 负责建房和加入；PATCH 负责
 * 选牌、舍牌、放弃荣和及荣和。敏感的对手手牌和房间凭证不会直接暴露。
 */
import { createRoomRecord, ensureRoomsTable, readRoom, saveRoom } from '../../../db/rooms';
import { ensureAuthTables, getSessionUser } from '../../../db/auth';
import {
  createWall,
  evaluateWin,
  isFuriten,
  suggestTenpaiHand,
  tileType,
  waitTypes,
  type ScoreResult,
} from '../../../lib/mahjong';
import {
  enforceRateLimit,
  parseJsonObject,
  requireSameOrigin,
  secureRandomIndex,
} from '../../../lib/security';

type Seat = 0 | 1;
type GameResult = {
  kind: 'ron' | 'draw';
  winner?: Seat;
  score?: ScoreResult;
  payment?: number;
  winnerHand?: number[];
  uraIndicator?: number;
};

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
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = () =>
  Array.from({ length: 6 }, () => CODE_CHARS[secureRandomIndex(CODE_CHARS.length)]).join('');
const token = () => crypto.randomUUID().replaceAll('-', '');

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

function publicRoom(room: RoomState, seat: Seat) {
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
  };
}

function makeRoom(baseScore: number, userId: string): RoomState {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const wall = createWall();
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
    return Response.json(publicRoom(loaded.room, loaded.seat), {
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
    requireSameOrigin(request);
    enforceRateLimit(request, 'rooms', 20);
    await ensureRoomsTable();
    await ensureAuthTables();
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: '请先登录后再进行联机对战' }, { status: 401 });
    const body = await parseJsonObject(request);
    const action = typeof body.action === 'string' ? body.action : '';
    if (action === 'create') {
      const allowedScores = new Set([1000, 5000, 10000]);
      const room = makeRoom(
        allowedScores.has(body.baseScore as number) ? (body.baseScore as number) : 5000,
        user.id,
      );
      while (await readRoom(room.code)) room.code = randomCode();
      await createRoomRecord(room.code, room);
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
      if (!(await saveRoom(code, room, expectedVersion)))
        return Response.json({ error: '房间状态刚刚变化，请重试' }, { status: 409 });
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
    const { room, seat } = loaded;
    const expectedVersion = room.version;

    if (body.action === 'select') {
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
      } else if (room.counts[0] >= 17 && room.counts[1] >= 17) room.result = { kind: 'draw' };
      else room.turn = opponent;
    } else if (body.action === 'pass') {
      if (room.pendingRon !== seat)
        return Response.json({ error: '没有可放弃的荣和机会' }, { status: 409 });
      room.temporaryFuriten[seat] = true;
      room.pendingRon = null;
      room.pendingScore = null;
      if (room.counts[0] >= 17 && room.counts[1] >= 17) room.result = { kind: 'draw' };
      else room.turn = seat;
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
    } else return Response.json({ error: '未知的对局操作' }, { status: 400 });

    room.version += 1;
    if (!(await saveRoom(code, room, expectedVersion)))
      return Response.json({ error: '对局状态刚刚变化，请重试' }, { status: 409 });
    return Response.json(publicRoom(room, seat));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '对局操作失败' },
      { status: 500 },
    );
  }
}
