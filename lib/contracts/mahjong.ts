/** 本项目的固定玩家自风。 */
export type SeatWind = 'east' | 'west';

/** 逻辑牌种编号 0–33。 */
export type TileType = number;

/** 实体牌编号 0–135；每种牌有四个实体编号。 */
export type PhysicalTileId = number;

/** 满贯以上计分档位。 */
export type LimitTier = '满贯' | '跳满' | '倍满' | '三倍满' | '役满';

/** 规则引擎和联机协议共用的荣和计分结果。 */
export interface ScoreResult {
  han: number;
  fu: number;
  tier: LimitTier | null;
  multiplier: 0 | 1 | 1.5 | 2 | 3 | 4;
  yaku: string[];
  dora: number;
  uraDora: number;
  winningTile: TileType;
}

/** 对局座位；0 为庄家东家，1 为闲家西家。 */
export type Seat = 0 | 1;

/** 一局对战的公开结算结果。 */
export interface GameResult {
  kind: 'ron' | 'draw';
  winner?: Seat;
  score?: ScoreResult;
  payment?: number;
  winnerHand?: TileType[];
  uraIndicator?: TileType;
}

/** 联机 API 返回给当前座位的可见房间快照，不包含对手隐藏手牌。 */
export interface RoomSnapshot {
  code: string;
  phase: 'waiting' | 'selecting' | 'playing' | 'finished';
  seat: Seat;
  opponentJoined: boolean;
  opponentReady: boolean;
  ownReady: boolean;
  ownPool?: PhysicalTileId[];
  ownHand?: TileType[];
  indicator: TileType;
  baseScore: number;
  turn: Seat;
  discards: [TileType[], TileType[]];
  counts: [number, number];
  reserveCounts: [number, number];
  ownRemaining?: PhysicalTileId[];
  pendingRon: Seat | null;
  canRon: boolean;
  pendingScore?: ScoreResult | null;
  temporaryFuriten: boolean;
  permanentFuriten: boolean;
  lastDiscard: { seat: Seat; tile: TileType } | null;
  result: GameResult | null;
  version: number;
}
