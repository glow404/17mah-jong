import { RuleEngineError } from './errors';
import type { TileType } from './types';

/** 一组面子的结构；tile 是顺子的起始牌种或刻子的牌种。 */
export interface Meld {
  kind: 'sequence' | 'triplet';
  tile: TileType;
}

/** 标准四面子一雀头拆解。 */
export interface Decomposition {
  pair: TileType;
  melds: Meld[];
}

/** 国士无双所需的 13 种幺九牌。 */
export const ORPHANS: ReadonlySet<TileType> = new Set([
  0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33,
]);

function validTiles(tiles: readonly number[]): boolean {
  return (
    tiles.every((tile) => Number.isInteger(tile) && tile >= 0 && tile < 34) &&
    countTiles(tiles).every((count) => count <= 4)
  );
}

/** 计算每种牌的数量；遇到非法牌种时抛出统一规则错误。 */
export function countTiles(tiles: readonly TileType[]): number[] {
  const counts = Array<number>(34).fill(0);
  for (const tile of tiles) {
    if (!Number.isInteger(tile) || tile < 0 || tile >= 34)
      throw new RuleEngineError('INVALID_TILE', `Invalid tile type: ${tile}`);
    counts[tile] += 1;
  }
  return counts;
}

function isSequenceStart(tile: TileType): boolean {
  return tile < 27 && tile % 9 <= 6;
}

function collectMelds(counts: number[], melds: Meld[], result: Meld[][]): void {
  const tile = counts.findIndex((count) => count > 0);
  if (tile === -1) {
    if (melds.length === 4) result.push([...melds]);
    return;
  }
  if (counts[tile] >= 3) {
    counts[tile] -= 3;
    collectMelds(counts, [...melds, { kind: 'triplet', tile }], result);
    counts[tile] += 3;
  }
  if (isSequenceStart(tile) && counts[tile + 1] > 0 && counts[tile + 2] > 0) {
    counts[tile] -= 1;
    counts[tile + 1] -= 1;
    counts[tile + 2] -= 1;
    collectMelds(counts, [...melds, { kind: 'sequence', tile }], result);
    counts[tile] += 1;
    counts[tile + 1] += 1;
    counts[tile + 2] += 1;
  }
}

/**
 * 枚举 14 张牌的所有标准四面子一雀头拆解。
 * 非法牌数、非法牌种或第五张同牌返回空数组；七对子/国士不属于此拆解。
 */
export function decomposeHand(tiles: readonly TileType[]): Decomposition[] {
  if (tiles.length !== 14 || !validTiles(tiles)) return [];
  const result: Decomposition[] = [];
  const counts = countTiles(tiles);
  for (let pair = 0; pair < 34; pair += 1) {
    if (counts[pair] < 2) continue;
    counts[pair] -= 2;
    const meldLists: Meld[][] = [];
    collectMelds(counts, [], meldLists);
    for (const melds of meldLists) result.push({ pair, melds });
    counts[pair] += 2;
  }
  return result;
}

/** 判断牌型是否为七对子（不接受四张相同牌算作两对）。 */
export function isChiitoitsu(tiles: readonly TileType[]): boolean {
  if (tiles.length !== 14 || !validTiles(tiles)) return false;
  return countTiles(tiles).filter((count) => count === 2).length === 7;
}

/** 判断牌型是否为国士无双。 */
export function isKokushi(tiles: readonly TileType[]): boolean {
  if (tiles.length !== 14 || !validTiles(tiles)) return false;
  const counts = countTiles(tiles);
  return (
    [...ORPHANS].every((tile) => counts[tile] >= 1) &&
    [...ORPHANS].some((tile) => counts[tile] >= 2)
  );
}

/** 判断 14 张牌是否构成七对子、国士无双或标准和牌结构。 */
export function isWinningHand(tiles: readonly TileType[]): boolean {
  if (tiles.length !== 14 || !validTiles(tiles)) return false;
  return isChiitoitsu(tiles) || isKokushi(tiles) || decomposeHand(tiles).length > 0;
}

/**
 * 返回 13 张听牌手牌的所有有效等待牌种；输入不合法时返回空数组。
 * 每种候选牌至多检查一次，共最多 34 次完整和牌判断。
 */
export function waitTypes(hand: readonly TileType[]): TileType[] {
  if (hand.length !== 13 || !validTiles(hand)) return [];
  const counts = countTiles(hand);
  const waits: TileType[] = [];
  for (let tile = 0; tile < 34; tile += 1) {
    if (counts[tile] < 4 && isWinningHand([...hand, tile])) waits.push(tile);
  }
  return waits;
}
