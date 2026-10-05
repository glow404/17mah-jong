import { assertPhysicalTileId, assertTileType, RuleEngineError } from './errors';
import type { PhysicalTileId, RandomSource, TileType } from './types';

const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HONORS = ['东', '南', '西', '北', '白', '发', '中'];

/** 将实体牌编号（0–135）映射到牌种编号（0–33）。 */
export function tileType(physicalId: PhysicalTileId): TileType {
  assertPhysicalTileId(physicalId);
  return Math.floor(physicalId / 4);
}

/** 返回牌种的人类可读标签，适用于无图案字体的辅助说明。 */
export function tileLabel(tile: TileType): { main: string; suit: string; kind: string } {
  assertTileType(tile);
  if (tile >= 27)
    return { main: HONORS[tile - 27], suit: '', kind: tile >= 31 ? 'dragon' : 'wind' };
  const suitIndex = Math.floor(tile / 9);
  return {
    main: NUMERALS[tile % 9],
    suit: ['万', '筒', '索'][suitIndex],
    kind: ['man', 'pin', 'sou'][suitIndex],
  };
}

/** 将牌种转换为中文牌名。 */
export function tileText(tile: TileType): string {
  const label = tileLabel(tile);
  return `${label.main}${label.suit}`;
}

/** 返回 Unicode 麻将牌图案。 */
export function tileGlyph(tile: TileType): string {
  assertTileType(tile);
  if (tile < 9) return String.fromCodePoint(0x1f007 + tile);
  if (tile < 18) return String.fromCodePoint(0x1f019 + tile - 9);
  if (tile < 27) return String.fromCodePoint(0x1f010 + tile - 18);
  const honorPoints = [0x1f000, 0x1f001, 0x1f002, 0x1f003, 0x1f006, 0x1f005, 0x1f004];
  return String.fromCodePoint(honorPoints[tile - 27]);
}

/** 按牌种、再按实体编号升序返回副本，不修改传入数组。 */
export function sortTiles<T extends PhysicalTileId>(tiles: readonly T[]): T[] {
  return [...tiles].sort((a, b) => tileType(a) - tileType(b) || a - b);
}

/** 使用 Fisher–Yates 算法洗牌；随机数源可注入以复现固定序列。 */
export function shuffle<T>(items: readonly T[], random: RandomSource): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new RuleEngineError(
        'INVALID_RANDOM_VALUE',
        'Random source must return a value in [0, 1)',
      );
    const other = Math.floor(value * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

/** 创建由 136 张实体牌组成的随机牌墙；传入同一随机源可复现结果。 */
export function createWall(random: RandomSource): PhysicalTileId[] {
  return shuffle(
    Array.from({ length: 136 }, (_, index) => index),
    random,
  );
}

/** 从固定整数种子创建可复现的 Mulberry32 随机数源。 */
export function createSeededRandom(seed: number): RandomSource {
  if (!Number.isSafeInteger(seed))
    throw new RuleEngineError('INVALID_SEED', 'Seed must be a safe integer');
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** 根据宝牌指示牌计算下一张循环牌种。 */
export function doraFromIndicator(indicator: TileType): TileType {
  assertTileType(indicator);
  if (indicator < 27) {
    const suit = Math.floor(indicator / 9) * 9;
    return suit + (((indicator % 9) + 1) % 9);
  }
  if (indicator <= 30) return 27 + ((indicator - 27 + 1) % 4);
  return 31 + ((indicator - 31 + 1) % 3);
}
