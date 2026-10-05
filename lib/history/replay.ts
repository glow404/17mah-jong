import type { GameResult, Seat } from '../contracts/mahjong';
import { isFuriten } from '../rules/furiten';
import { evaluateWin } from '../rules/scoring';
import { sortTiles, tileType } from '../rules/tiles';
import type { MatchEvent, MatchEventInput, ReplayState } from './events';

export class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayError';
  }
}

function seatOf(value: Seat | null): Seat {
  if (value !== 0 && value !== 1) throw new ReplayError('此牌谱事件缺少有效座位');
  return value;
}

function assertEventMetadata(event: MatchEventInput) {
  if (
    !Number.isSafeInteger(event.stateVersion) ||
    event.stateVersion < 1 ||
    !Number.isSafeInteger(event.createdAt) ||
    event.createdAt < 0 ||
    (event.seat !== null && event.seat !== 0 && event.seat !== 1)
  )
    throw new ReplayError('牌谱事件包含无效的版本、时间或座位');

  if (event.type === 'match.created' && (event.seat !== 0 || event.stateVersion !== 1))
    throw new ReplayError('建局事件的初始版本无效');
  if (
    event.type === 'match.restored' &&
    (event.seat !== null || event.stateVersion !== event.payload.state.version)
  )
    throw new ReplayError('状态恢复事件与检查点版本不一致');
  if (event.type === 'player.joined' && event.seat !== 1)
    throw new ReplayError('入座事件必须属于西家');
  if (
    event.type === 'turn.deadline.started' &&
    (event.seat === null || !Number.isSafeInteger(event.payload.turnDeadlineAt))
  )
    throw new ReplayError('回合时限事件无效');
  if (
    event.type === 'hand.drawn' &&
    event.payload.reason !== 'seventeen-discard' &&
    event.payload.reason !== 'both-disconnected'
  )
    throw new ReplayError('流局原因无效');
  if (
    event.type === 'player.forfeited' &&
    !['resigned', 'turn-timeout', 'disconnect'].includes(event.payload.reason)
  )
    throw new ReplayError('判负原因无效');
}

function assertNextVersion(state: ReplayState | null, event: MatchEventInput) {
  if (!state) return;
  if (
    event.stateVersion !== state.version + 1 &&
    !(
      event.type === 'hand.drawn' &&
      event.payload.reason === 'seventeen-discard' &&
      event.stateVersion === state.version &&
      event.seat === null &&
      state.counts[0] === 17 &&
      state.counts[1] === 17
    )
  )
    throw new ReplayError('牌谱版本不连续，无法安全重建');
}

/** Applies one immutable event and returns a new state without mutating prior frames. */
export function applyMatchEvent(current: ReplayState | null, event: MatchEventInput): ReplayState {
  assertEventMetadata(event);
  assertNextVersion(current, event);

  if (event.type === 'match.created') {
    if (current) throw new ReplayError('建局事件只能出现在牌谱开头');
    const pools = event.payload.pools;
    const physicalIds = pools.flat();
    if (
      ![1000, 5000, 10000].includes(event.payload.baseScore) ||
      pools.some((pool) => pool.length !== 34) ||
      physicalIds.some((id) => !Number.isSafeInteger(id) || id < 0 || id >= 136) ||
      new Set(physicalIds).size !== physicalIds.length ||
      !Number.isSafeInteger(event.payload.indicator) ||
      event.payload.indicator < 0 ||
      event.payload.indicator > 33 ||
      !Number.isSafeInteger(event.payload.uraIndicator) ||
      event.payload.uraIndicator < 0 ||
      event.payload.uraIndicator > 33
    )
      throw new ReplayError('建局事件包含无效牌池或宝牌信息');
    return {
      baseScore: event.payload.baseScore,
      pools: [pools[0].slice(), pools[1].slice()],
      hands: [null, null],
      reserves: [[], []],
      discards: [[], []],
      counts: [0, 0],
      temporaryFuriten: [false, false],
      indicator: event.payload.indicator,
      uraIndicator: event.payload.uraIndicator,
      opponentJoined: Boolean(event.payload.opponentJoined),
      turn: 0,
      pendingRon: null,
      pendingScore: null,
      lastDiscard: null,
      result: null,
      turnDeadlineAt: null,
      version: event.stateVersion,
    };
  }

  if (event.type === 'match.restored') {
    if (current) throw new ReplayError('状态恢复事件只能出现在牌谱开头');
    const restored = cloneReplayState(event.payload.state);
    assertReplayState(restored);
    return restored;
  }

  if (!current) throw new ReplayError('牌谱缺少建局或状态恢复事件');
  if (current.result) throw new ReplayError('牌局结束后不能再有操作事件');
  const next = cloneReplayState(current);
  const seat = event.seat === null ? null : seatOf(event.seat);
  next.version = event.stateVersion;

  switch (event.type) {
    case 'player.joined':
      if (next.opponentJoined) throw new ReplayError('牌谱包含重复入座事件');
      next.opponentJoined = true;
      break;

    case 'hand.selected': {
      if (seat === null) throw new ReplayError('选牌事件缺少座位');
      if (!next.opponentJoined || next.hands[seat]) throw new ReplayError('选牌事件顺序无效');
      const selected = event.payload.selectedIds;
      const selectedSet = new Set(selected);
      if (
        selected.length !== 13 ||
        selectedSet.size !== 13 ||
        selected.some((id) => !next.pools[seat].includes(id))
      )
        throw new ReplayError('牌谱包含无效选牌');
      next.hands[seat] = selected.map(tileType).sort((left, right) => left - right);
      next.reserves[seat] = sortTiles(next.pools[seat].filter((id) => !selectedSet.has(id)));
      next.turnDeadlineAt = event.payload.turnDeadlineAt;
      if (next.hands[0] && next.hands[1]) next.turn = 0;
      break;
    }

    case 'turn.deadline.started':
      next.turnDeadlineAt = event.payload.turnDeadlineAt;
      break;

    case 'tile.discarded': {
      if (
        seat === null ||
        !next.opponentJoined ||
        !next.hands[0] ||
        !next.hands[1] ||
        next.pendingRon !== null ||
        next.turn !== seat ||
        next.counts[seat] >= 17
      )
        throw new ReplayError('舍牌事件不符合当前牌局状态');
      const tileIndex = next.reserves[seat].indexOf(event.payload.physicalTileId);
      if (tileIndex < 0) throw new ReplayError('舍牌不属于该玩家的剩余牌池');
      const [physicalTile] = next.reserves[seat].splice(tileIndex, 1);
      const tile = tileType(physicalTile);
      const opponent = (1 - seat) as Seat;
      next.counts[seat] += 1;
      next.discards[seat].push(tile);
      next.temporaryFuriten[seat] = false;
      next.lastDiscard = { seat, tile };
      const score = evaluateWin(
        next.hands[opponent]!,
        tile,
        next.indicator,
        opponent === 0 ? 'east' : 'west',
        next.uraIndicator,
      );
      if (
        score?.tier &&
        !isFuriten(next.hands[opponent]!, next.discards[opponent], next.temporaryFuriten[opponent])
      ) {
        next.pendingRon = opponent;
        next.pendingScore = score;
      } else next.turn = opponent;
      next.turnDeadlineAt = event.payload.turnDeadlineAt;
      break;
    }

    case 'ron.declined':
      if (seat === null || next.pendingRon !== seat)
        throw new ReplayError('放弃荣和事件没有对应的荣和机会');
      next.temporaryFuriten[seat] = true;
      next.pendingRon = null;
      next.pendingScore = null;
      next.turn = seat;
      next.turnDeadlineAt = event.payload.turnDeadlineAt;
      break;

    case 'ron.claimed': {
      if (seat === null || next.pendingRon !== seat || !next.pendingScore || !next.hands[seat])
        throw new ReplayError('荣和事件没有对应的合法和牌');
      const result: GameResult = {
        kind: 'ron',
        winner: seat,
        score: next.pendingScore,
        payment: Math.round(next.baseScore * next.pendingScore.multiplier),
        winnerHand: next.hands[seat]!.slice(),
        uraIndicator: next.uraIndicator,
      };
      next.result = result;
      next.turnDeadlineAt = null;
      break;
    }

    case 'hand.drawn':
      if (
        seat !== null ||
        next.pendingRon !== null ||
        !next.hands[0] ||
        !next.hands[1] ||
        !next.opponentJoined ||
        (event.payload.reason === 'seventeen-discard' &&
          (next.counts[0] !== 17 || next.counts[1] !== 17))
      )
        throw new ReplayError('流局事件不符合当前牌局状态');
      next.result = {
        kind: 'draw',
        ...(event.payload.reason === 'both-disconnected'
          ? { reason: 'both-disconnected' as const }
          : {}),
      };
      next.turnDeadlineAt = null;
      break;

    case 'player.forfeited': {
      if (seat === null || event.payload.winner !== 1 - seat)
        throw new ReplayError('判负事件中的胜负座位无效');
      next.result = {
        kind: 'forfeit',
        winner: event.payload.winner,
        loser: seat,
        reason: event.payload.reason,
      };
      next.pendingRon = null;
      next.pendingScore = null;
      next.turnDeadlineAt = null;
      break;
    }

    default:
      throw new ReplayError('牌谱包含不支持的事件类型');
  }

  return next;
}

function assertReplayState(state: ReplayState) {
  const physicalIds = state.pools.flat();
  const validPhysical = (id: number) => Number.isSafeInteger(id) && id >= 0 && id < 136;
  const validTile = (tile: number) => Number.isSafeInteger(tile) && tile >= 0 && tile <= 33;
  if (
    ![1000, 5000, 10000].includes(state.baseScore) ||
    !Number.isSafeInteger(state.version) ||
    state.version < 1 ||
    state.pools.some((pool) => pool.length !== 34 || pool.some((id) => !validPhysical(id))) ||
    new Set(physicalIds).size !== physicalIds.length ||
    state.hands.some(
      (hand) => hand !== null && (hand.length !== 13 || hand.some((tile) => !validTile(tile))),
    ) ||
    state.reserves.some(
      (reserve, seat) =>
        reserve.some((id) => !validPhysical(id) || !state.pools[seat].includes(id)) ||
        new Set(reserve).size !== reserve.length ||
        (state.hands[seat] === null
          ? reserve.length !== 0 || state.counts[seat] !== 0
          : reserve.length !== 21 - state.counts[seat]),
    ) ||
    state.counts.some(
      (count, seat) => count !== state.discards[seat].length || count < 0 || count > 17,
    ) ||
    state.discards.some((river) => river.some((tile) => !validTile(tile))) ||
    !validTile(state.indicator) ||
    !validTile(state.uraIndicator) ||
    (state.turn !== 0 && state.turn !== 1) ||
    (state.pendingRon !== null && state.pendingRon !== 0 && state.pendingRon !== 1)
  )
    throw new ReplayError('恢复快照包含无效的牌局状态');
}

/** Rebuilds every state in a replay, preserving a seekable state after each event. */
export function replayMatchEvents(events: readonly MatchEvent[]): ReplayState[] {
  if (!events.length) throw new ReplayError('牌谱没有事件');
  const frames: ReplayState[] = [];
  let state: ReplayState | null = null;
  let expectedSequence = 1;
  for (const event of events) {
    if (event.sequence !== expectedSequence) throw new ReplayError('牌谱事件序号不连续');
    state = applyMatchEvent(state, event);
    frames.push(state);
    expectedSequence += 1;
  }
  if (!state || !state.result) throw new ReplayError('牌谱尚未结束');
  return frames;
}

function cloneReplayState(state: ReplayState): ReplayState {
  return {
    ...state,
    pools: [state.pools[0].slice(), state.pools[1].slice()],
    hands: [state.hands[0]?.slice() ?? null, state.hands[1]?.slice() ?? null],
    reserves: [state.reserves[0].slice(), state.reserves[1].slice()],
    discards: [state.discards[0].slice(), state.discards[1].slice()],
    counts: [state.counts[0], state.counts[1]],
    temporaryFuriten: [state.temporaryFuriten[0], state.temporaryFuriten[1]],
    lastDiscard: state.lastDiscard ? { ...state.lastDiscard } : null,
    result:
      state.result?.kind === 'ron'
        ? {
            ...state.result,
            winnerHand: state.result.winnerHand?.slice(),
            score: { ...state.result.score },
          }
        : state.result
          ? { ...state.result }
          : null,
    pendingScore: state.pendingScore
      ? { ...state.pendingScore, yaku: state.pendingScore.yaku.slice() }
      : null,
  };
}
