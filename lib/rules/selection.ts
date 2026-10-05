import { countTiles, waitTypes, type Meld } from './hand';
import { evaluateWin } from './scoring';
import { doraFromIndicator, sortTiles, tileType } from './tiles';
import type { PhysicalTileId, ScoreResult, SeatWind, TileType } from './types';

function physicalSelection(pool: readonly PhysicalTileId[], wantedTypes: readonly TileType[]) {
  const buckets = new Map<TileType, PhysicalTileId[]>();
  for (const id of pool) {
    const type = tileType(id);
    buckets.set(type, [...(buckets.get(type) ?? []), id]);
  }
  const selection: PhysicalTileId[] = [];
  for (const type of wantedTypes) {
    const id = buckets.get(type)?.shift();
    if (id === undefined) return null;
    selection.push(id);
  }
  return sortTiles(selection);
}

/**
 * 从给定的实体牌池中启发式搜索一副听牌 13 张手牌，返回实体牌编号。
 * 搜索最多评估 5,200 个候选；不是所有合法牌池都保证找到候选。
 */
export function suggestTenpaiHand(
  pool: readonly PhysicalTileId[],
  indicator: TileType,
  wind: SeatWind,
): PhysicalTileId[] | null {
  const poolCounts = countTiles(pool.map(tileType));
  let best: { types: TileType[]; rank: number } | null = null;
  let considered = 0;
  const seen = new Set<string>();

  const consider = (types: TileType[]) => {
    if (considered >= 5200 || types.length !== 13) return;
    const sorted = [...types].sort((a, b) => a - b);
    const key = sorted.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    considered += 1;
    const waits = waitTypes(sorted);
    if (!waits.length) return;
    const scores = waits
      .map((tile) => evaluateWin(sorted, tile, indicator, wind))
      .filter((score): score is ScoreResult => Boolean(score));
    const top = scores.sort(
      (a, b) => b.multiplier - a.multiplier || b.han - a.han || b.fu - a.fu,
    )[0];
    const rank =
      (top?.multiplier ?? 0) * 10000 +
      (top?.han ?? 0) * 100 +
      waits.length * 8 +
      sorted.filter((tile) => tile === doraFromIndicator(indicator)).length;
    if (!best || rank > best.rank) best = { types: sorted, rank };
  };

  const search = (allowed: (tile: TileType) => boolean, budget: number) => {
    const meldOptions: Meld[] = [];
    for (let tile = 0; tile < 34; tile += 1) {
      if (!allowed(tile)) continue;
      if (poolCounts[tile] >= 3) meldOptions.push({ kind: 'triplet', tile });
      if (
        tile < 27 &&
        tile % 9 <= 6 &&
        allowed(tile + 1) &&
        allowed(tile + 2) &&
        poolCounts[tile] > 0 &&
        poolCounts[tile + 1] > 0 &&
        poolCounts[tile + 2] > 0
      )
        meldOptions.push({ kind: 'sequence', tile });
    }
    const taatsu: TileType[][] = [];
    for (let tile = 0; tile < 34; tile += 1) {
      if (!allowed(tile)) continue;
      if (poolCounts[tile] >= 2) taatsu.push([tile, tile]);
      if (
        tile < 27 &&
        tile % 9 <= 7 &&
        allowed(tile + 1) &&
        poolCounts[tile] > 0 &&
        poolCounts[tile + 1] > 0
      )
        taatsu.push([tile, tile + 1]);
      if (
        tile < 27 &&
        tile % 9 <= 6 &&
        allowed(tile + 2) &&
        poolCounts[tile] > 0 &&
        poolCounts[tile + 2] > 0
      )
        taatsu.push([tile, tile + 2]);
    }
    const remaining = [...poolCounts];
    const chosen: TileType[] = [];
    const startCount = considered;
    const applyMeld = (option: Meld, delta: number) => {
      const tiles =
        option.kind === 'triplet'
          ? [option.tile, option.tile, option.tile]
          : [option.tile, option.tile + 1, option.tile + 2];
      tiles.forEach((tile) => {
        remaining[tile] += delta;
      });
    };
    const walk = (depth: number, from: number) => {
      if (considered - startCount >= budget || considered >= 5200) return;
      if (depth === 3) {
        for (let pair = 0; pair < 34; pair += 1) {
          if (!allowed(pair) || remaining[pair] < 2) continue;
          remaining[pair] -= 2;
          for (const shape of taatsu) {
            const needed = countTiles(shape);
            if (needed.every((count, tile) => count <= remaining[tile]))
              consider([...chosen, pair, pair, ...shape]);
            if (considered - startCount >= budget) break;
          }
          remaining[pair] += 2;
          if (considered - startCount >= budget) break;
        }
        return;
      }
      for (let index = from; index < meldOptions.length; index += 1) {
        const option = meldOptions[index];
        const tiles =
          option.kind === 'triplet'
            ? [option.tile, option.tile, option.tile]
            : [option.tile, option.tile + 1, option.tile + 2];
        const need = countTiles(tiles);
        if (need.some((count, tile) => count > remaining[tile])) continue;
        applyMeld(option, -1);
        chosen.push(...tiles);
        walk(depth + 1, index);
        chosen.splice(chosen.length - 3, 3);
        applyMeld(option, 1);
      }
    };
    walk(0, 0);
  };

  for (let suit = 0; suit < 3; suit += 1)
    search((tile) => tile >= 27 || Math.floor(tile / 9) === suit, 1150);
  search(() => true, 1750);

  if (!best) {
    const pairs = poolCounts
      .map((count, tile) => (count >= 2 ? tile : -1))
      .filter((tile) => tile >= 0);
    if (pairs.length >= 6) {
      const singles = poolCounts
        .map((count, tile) => (count ? tile : -1))
        .filter((tile) => tile >= 0);
      for (const single of singles) {
        const pairTypes = pairs.filter((tile) => tile !== single).slice(0, 6);
        if (pairTypes.length === 6)
          consider([...pairTypes.flatMap((tile) => [tile, tile]), single]);
      }
    }
  }
  const selected = best as { types: TileType[]; rank: number } | null;
  return selected ? physicalSelection(pool, selected.types) : null;
}
