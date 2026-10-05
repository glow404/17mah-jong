import type { GameResult } from '../contracts/mahjong';
import type {
  MatchEvent,
  MatchEventInput,
  MatchHistorySummary,
  MatchReplayExport,
  ReplayState,
} from './events';

/** Builds a portable replay document while explicitly removing private archive fields. */
export function createMatchReplayExport(
  match: MatchHistorySummary,
  events: readonly MatchEvent[],
): MatchReplayExport {
  return {
    format: '17mah-jong-replay',
    schemaVersion: 1,
    match: {
      matchId: match.matchId,
      startedAt: match.startedAt,
      finishedAt: match.finishedAt,
      baseScore: match.baseScore,
      viewerSeat: match.viewerSeat,
      result: sanitizeResult(match.result),
    },
    events: events.map(sanitizeEvent),
  };
}

function sanitizeResult(result: GameResult): GameResult {
  return result.kind === 'ron'
    ? {
        kind: 'ron',
        winner: result.winner,
        payment: result.payment,
        score: {
          han: result.score.han,
          fu: result.score.fu,
          tier: result.score.tier,
          multiplier: result.score.multiplier,
          yaku: result.score.yaku.slice(),
          dora: result.score.dora,
          uraDora: result.score.uraDora,
          winningTile: result.score.winningTile,
        },
        winnerHand: result.winnerHand?.slice(),
        uraIndicator: result.uraIndicator,
      }
    : result.kind === 'draw'
      ? { kind: 'draw', reason: result.reason }
      : {
          kind: 'forfeit',
          winner: result.winner,
          loser: result.loser,
          reason: result.reason,
        };
}

function sanitizeState(state: ReplayState): ReplayState {
  return {
    baseScore: state.baseScore,
    pools: [state.pools[0].slice(), state.pools[1].slice()],
    hands: [state.hands[0]?.slice() ?? null, state.hands[1]?.slice() ?? null],
    reserves: [state.reserves[0].slice(), state.reserves[1].slice()],
    discards: [state.discards[0].slice(), state.discards[1].slice()],
    counts: [state.counts[0], state.counts[1]],
    temporaryFuriten: [state.temporaryFuriten[0], state.temporaryFuriten[1]],
    indicator: state.indicator,
    uraIndicator: state.uraIndicator,
    opponentJoined: state.opponentJoined,
    turn: state.turn,
    pendingRon: state.pendingRon,
    pendingScore: state.pendingScore
      ? { ...state.pendingScore, yaku: [...state.pendingScore.yaku] }
      : null,
    lastDiscard: state.lastDiscard ? { ...state.lastDiscard } : null,
    result: state.result ? sanitizeResult(state.result) : null,
    turnDeadlineAt: state.turnDeadlineAt,
    version: state.version,
  };
}

function sanitizeEvent(event: MatchEvent): MatchEvent {
  let safe: MatchEventInput;
  switch (event.type) {
    case 'match.created':
      safe = {
        type: event.type,
        seat: 0,
        stateVersion: event.stateVersion,
        createdAt: event.createdAt,
        payload: {
          baseScore: event.payload.baseScore,
          pools: [event.payload.pools[0].slice(), event.payload.pools[1].slice()],
          indicator: event.payload.indicator,
          uraIndicator: event.payload.uraIndicator,
          opponentJoined: Boolean(event.payload.opponentJoined),
        },
      };
      break;
    case 'match.restored':
      safe = {
        type: event.type,
        seat: null,
        stateVersion: event.stateVersion,
        createdAt: event.createdAt,
        payload: { state: sanitizeState(event.payload.state) },
      };
      break;
    case 'player.joined':
    case 'ron.claimed':
      safe = {
        type: event.type,
        seat: event.seat,
        stateVersion: event.stateVersion,
        createdAt: event.createdAt,
        payload: {},
      };
      break;
    case 'hand.selected':
      safe = {
        type: event.type,
        seat: event.seat,
        stateVersion: event.stateVersion,
        createdAt: event.createdAt,
        payload: {
          selectedIds: event.payload.selectedIds.slice(),
          turnDeadlineAt: event.payload.turnDeadlineAt,
        },
      };
      break;
    case 'turn.deadline.started':
      safe = {
        type: event.type,
        seat: event.seat,
        stateVersion: event.stateVersion,
        createdAt: event.createdAt,
        payload: { turnDeadlineAt: event.payload.turnDeadlineAt },
      };
      break;
    case 'tile.discarded':
      safe = {
        type: event.type,
        seat: event.seat,
        stateVersion: event.stateVersion,
        createdAt: event.createdAt,
        payload: {
          physicalTileId: event.payload.physicalTileId,
          turnDeadlineAt: event.payload.turnDeadlineAt,
        },
      };
      break;
    case 'ron.declined':
      safe = {
        type: event.type,
        seat: event.seat,
        stateVersion: event.stateVersion,
        createdAt: event.createdAt,
        payload: { turnDeadlineAt: event.payload.turnDeadlineAt },
      };
      break;
    case 'hand.drawn':
      safe = {
        type: event.type,
        seat: null,
        stateVersion: event.stateVersion,
        createdAt: event.createdAt,
        payload: { reason: event.payload.reason },
      };
      break;
    case 'player.forfeited':
      safe = {
        type: event.type,
        seat: event.seat,
        stateVersion: event.stateVersion,
        createdAt: event.createdAt,
        payload: { winner: event.payload.winner, reason: event.payload.reason },
      };
      break;
  }
  return { sequence: event.sequence, ...safe } as MatchEvent;
}
