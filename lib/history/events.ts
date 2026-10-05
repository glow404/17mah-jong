import type { ForfeitReason, GameResult, ScoreResult, Seat } from '../contracts/mahjong';

/** Private replay state without room credentials, account IDs, or network presence data. */
export interface ReplayState {
  baseScore: number;
  pools: [number[], number[]];
  hands: [number[] | null, number[] | null];
  reserves: [number[], number[]];
  discards: [number[], number[]];
  counts: [number, number];
  temporaryFuriten: [boolean, boolean];
  indicator: number;
  uraIndicator: number;
  opponentJoined: boolean;
  turn: Seat;
  pendingRon: Seat | null;
  pendingScore: ScoreResult | null;
  lastDiscard: { seat: Seat; tile: number } | null;
  result: GameResult | null;
  turnDeadlineAt: number | null;
  version: number;
}

export interface MatchCreatedPayload {
  baseScore: number;
  pools: [number[], number[]];
  indicator: number;
  uraIndicator: number;
  opponentJoined?: boolean;
}

export interface MatchEventPayloads {
  'match.created': MatchCreatedPayload;
  'match.restored': { state: ReplayState };
  'player.joined': Record<string, never>;
  'hand.selected': { selectedIds: number[]; turnDeadlineAt: number | null };
  'turn.deadline.started': { turnDeadlineAt: number };
  'tile.discarded': { physicalTileId: number; turnDeadlineAt: number | null };
  'ron.declined': { turnDeadlineAt: number | null };
  'ron.claimed': Record<string, never>;
  'hand.drawn': { reason: 'seventeen-discard' | 'both-disconnected' };
  'player.forfeited': { winner: Seat; reason: ForfeitReason };
}

export type MatchEventType = keyof MatchEventPayloads;

/** An append-only action record. stateVersion can repeat for a compound discard + draw. */
export type MatchEventInput = {
  [Type in MatchEventType]: {
    type: Type;
    seat: Seat | null;
    stateVersion: number;
    createdAt: number;
    payload: MatchEventPayloads[Type];
  };
}[MatchEventType];

/** Persisted event with its monotonically increasing per-match event sequence. */
export type MatchEvent = MatchEventInput & { sequence: number };

/** PII-free summary presented in the player's match-history list. */
export interface MatchHistorySummary {
  matchId: string;
  startedAt: number;
  finishedAt: number;
  baseScore: number;
  viewerSeat: Seat;
  result: GameResult;
}

/** Portable replay format. It deliberately excludes room codes and account/session data. */
export interface MatchReplayExport {
  format: '17mah-jong-replay';
  schemaVersion: 1;
  match: {
    matchId: string;
    startedAt: number;
    finishedAt: number;
    baseScore: number;
    viewerSeat: Seat;
    result: GameResult;
  };
  events: MatchEvent[];
}
