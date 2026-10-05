import { isFuriten } from '../../lib/rules/furiten';
import { evaluateWin } from '../../lib/rules/scoring';
import { tileType } from '../../lib/rules/tiles';
import type { ScoreResult } from '../../lib/contracts/mahjong';
import type { GameResult, Seat } from '../../lib/contracts/mahjong';

export type { GameResult, Seat } from '../../lib/contracts/mahjong';

export interface LocalGame {
  hands: [number[], number[]];
  reserves: [number[], number[]];
  discards: [number[], number[]];
  counts: [number, number];
  temporaryFuriten: [boolean, boolean];
  indicator: number;
  uraIndicator: number;
  turn: Seat;
  pendingRon: Seat | null;
  pendingScore: ScoreResult | null;
  lastDiscard: { seat: Seat; tile: number } | null;
  result: GameResult | null;
}

export type LocalGameAction =
  | { type: 'start'; game: LocalGame }
  | { type: 'reset' }
  | { type: 'discard'; seat: Seat; physicalId: number }
  | { type: 'pass' }
  | { type: 'ron'; baseScore: number }
  | { type: 'cpu-ron'; baseScore: number };

export function localGameReducer(
  state: LocalGame | null,
  action: LocalGameAction,
): LocalGame | null {
  if (action.type === 'reset') return null;
  if (action.type === 'start') return action.game;
  if (!state || state.result) return state;

  if (action.type === 'discard') {
    const { seat, physicalId } = action;
    if (state.pendingRon !== null || state.turn !== seat || state.counts[seat] >= 17) return state;
    const tileIndex = state.reserves[seat].indexOf(physicalId);
    if (tileIndex < 0) return state;
    const reserves: [number[], number[]] = [[...state.reserves[0]], [...state.reserves[1]]];
    const [discardedId] = reserves[seat].splice(tileIndex, 1);
    const tile = tileType(discardedId);
    const opponent = (1 - seat) as Seat;
    const counts: [number, number] = [...state.counts];
    const discards: [number[], number[]] = [[...state.discards[0]], [...state.discards[1]]];
    const temporaryFuriten: [boolean, boolean] = [...state.temporaryFuriten];
    counts[seat] += 1;
    discards[seat].push(tile);
    temporaryFuriten[seat] = false;
    const score = evaluateWin(
      state.hands[opponent],
      tile,
      state.indicator,
      opponent === 0 ? 'east' : 'west',
      state.uraIndicator,
    );
    if (
      score?.tier &&
      !isFuriten(state.hands[opponent], discards[opponent], temporaryFuriten[opponent])
    ) {
      return {
        ...state,
        reserves,
        counts,
        discards,
        temporaryFuriten,
        lastDiscard: { seat, tile },
        pendingRon: opponent,
        pendingScore: score,
      };
    }
    if (counts[0] >= 17 && counts[1] >= 17) {
      return {
        ...state,
        reserves,
        counts,
        discards,
        temporaryFuriten,
        lastDiscard: { seat, tile },
        result: { kind: 'draw' },
      };
    }
    return {
      ...state,
      reserves,
      counts,
      discards,
      temporaryFuriten,
      lastDiscard: { seat, tile },
      turn: opponent,
    };
  }

  if (action.type === 'pass') {
    if (state.pendingRon !== 0) return state;
    const temporaryFuriten: [boolean, boolean] = [true, state.temporaryFuriten[1]];
    if (state.counts[0] >= 17 && state.counts[1] >= 17)
      return {
        ...state,
        temporaryFuriten,
        pendingRon: null,
        pendingScore: null,
        result: { kind: 'draw' },
      };
    return { ...state, temporaryFuriten, pendingRon: null, pendingScore: null, turn: 0 };
  }

  const winner = action.type === 'ron' ? 0 : 1;
  if (state.pendingRon !== winner || !state.pendingScore) return state;
  return {
    ...state,
    result: {
      kind: 'ron',
      winner,
      score: state.pendingScore,
      payment: Math.round(action.baseScore * state.pendingScore.multiplier),
      winnerHand: state.hands[winner],
      uraIndicator: state.uraIndicator,
    },
  };
}
