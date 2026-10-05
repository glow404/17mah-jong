export type {
  LimitTier,
  PhysicalTileId,
  ScoreResult,
  SeatWind,
  TileType,
} from '../contracts/mahjong';

/** 可注入的随机数源；每次调用必须返回 [0, 1) 内的有限数。 */
export type RandomSource = () => number;
