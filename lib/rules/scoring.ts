import { assertTileType, RuleEngineError } from './errors';
import {
  countTiles,
  decomposeHand,
  isChiitoitsu,
  isKokushi,
  ORPHANS,
  waitTypes,
  type Decomposition,
} from './hand';
import { doraFromIndicator } from './tiles';
import type { ScoreResult, SeatWind, TileType } from './types';

/** 计算满贯及以上档位；非满贯返回 null 档位和 0 倍。 */
export function limitFor(
  han: number,
  fu: number,
  yakuman = false,
): Pick<ScoreResult, 'tier' | 'multiplier'> {
  if (yakuman || han >= 13) return { tier: '役满', multiplier: 4 };
  if (han >= 11) return { tier: '三倍满', multiplier: 3 };
  if (han >= 8) return { tier: '倍满', multiplier: 2 };
  if (han >= 6) return { tier: '跳满', multiplier: 1.5 };
  if (han >= 5 || (han === 4 && fu >= 40) || (han === 3 && fu >= 70))
    return { tier: '满贯', multiplier: 1 };
  return { tier: null, multiplier: 0 };
}

function isSimple(tile: TileType): boolean {
  return tile < 27 && tile % 9 > 0 && tile % 9 < 8;
}

function isTerminal(tile: TileType): boolean {
  return tile < 27 && (tile % 9 === 0 || tile % 9 === 8);
}

function flushYaku(tiles: readonly TileType[]): { name: string; han: number } | null {
  const suits = new Set(tiles.filter((tile) => tile < 27).map((tile) => Math.floor(tile / 9)));
  if (suits.size !== 1) return null;
  return tiles.some((tile) => tile >= 27) ? { name: '混一色', han: 3 } : { name: '清一色', han: 6 };
}

function commonYaku(tiles: readonly TileType[], dora: TileType, uraDora?: TileType) {
  const yaku: string[] = ['两立直'];
  let han = 2;
  if (tiles.every(isSimple)) {
    yaku.push('断幺九');
    han += 1;
  }
  if (tiles.every((tile) => ORPHANS.has(tile))) {
    yaku.push('混老头');
    han += 2;
  }
  const flush = flushYaku(tiles);
  if (flush) {
    yaku.push(flush.name);
    han += flush.han;
  }
  const doraCount = tiles.filter((tile) => tile === dora).length;
  if (doraCount) {
    yaku.push(`宝牌 ${doraCount}`);
    han += doraCount;
  }
  const uraDoraCount = uraDora === undefined ? 0 : tiles.filter((tile) => tile === uraDora).length;
  if (uraDoraCount) {
    yaku.push(`里宝牌 ${uraDoraCount}`);
    han += uraDoraCount;
  }
  return { yaku, han, doraCount, uraDoraCount };
}

function yakumanNames(tiles: readonly TileType[], forms: readonly Decomposition[]): string[] {
  if (isKokushi(tiles)) return ['国士无双'];
  const names: string[] = [];
  if (tiles.every((tile) => tile >= 27)) names.push('字一色');
  if (tiles.every(isTerminal)) names.push('清老头');
  const green = new Set([19, 20, 21, 23, 25, 32]);
  if (tiles.every((tile) => green.has(tile))) names.push('绿一色');
  const counts = countTiles(tiles);
  const suitSet = new Set(tiles.filter((tile) => tile < 27).map((tile) => Math.floor(tile / 9)));
  if (!tiles.some((tile) => tile >= 27) && suitSet.size === 1) {
    const base = [...suitSet][0] * 9;
    const suitCounts = counts.slice(base, base + 9);
    if (
      suitCounts[0] >= 3 &&
      suitCounts[8] >= 3 &&
      suitCounts.slice(1, 8).every((count) => count >= 1)
    )
      names.push('九莲宝灯');
  }
  for (const form of forms) {
    const triplets = form.melds.filter((meld) => meld.kind === 'triplet').map((meld) => meld.tile);
    if ([31, 32, 33].every((tile) => triplets.includes(tile))) names.push('大三元');
    const windTriplets = [27, 28, 29, 30].filter((tile) => triplets.includes(tile));
    if (windTriplets.length === 4) names.push('大四喜');
    else if (windTriplets.length === 3 && form.pair >= 27 && form.pair <= 30) names.push('小四喜');
    if (triplets.length === 4) names.push('四暗刻');
  }
  return [...new Set(names)];
}

function waitFu(form: Decomposition, winningTile: TileType): number {
  if (form.pair === winningTile) return 2;
  for (const meld of form.melds) {
    if (meld.kind !== 'sequence' || winningTile < meld.tile || winningTile > meld.tile + 2)
      continue;
    const rank = meld.tile % 9;
    if (
      winningTile === meld.tile + 1 ||
      (rank === 0 && winningTile === meld.tile + 2) ||
      (rank === 6 && winningTile === meld.tile)
    )
      return 2;
  }
  return 0;
}

function standardScore(
  tiles: readonly TileType[],
  form: Decomposition,
  winningTile: TileType,
  dora: TileType,
  wind: SeatWind,
  uraDora?: TileType,
): ScoreResult {
  const common = commonYaku(tiles, dora, uraDora);
  const yaku = [...common.yaku];
  let han = common.han;
  const sequences = form.melds.filter((meld) => meld.kind === 'sequence');
  const triplets = form.melds.filter((meld) => meld.kind === 'triplet');
  const valuePair = form.pair >= 31 || form.pair === (wind === 'east' ? 27 : 29);

  if (sequences.length === 4 && !valuePair && waitFu(form, winningTile) === 0) {
    yaku.push('平和');
    han += 1;
  }
  const sequenceKeys = sequences.map((meld) => meld.tile);
  if (sequenceKeys.some((tile, index) => sequenceKeys.indexOf(tile) !== index)) {
    yaku.push('一杯口');
    han += 1;
  }
  if (triplets.length === 4) {
    yaku.push('对对和');
    han += 2;
  }
  if (triplets.length >= 3) {
    yaku.push('三暗刻');
    han += 2;
  }

  const seatTile = wind === 'east' ? 27 : 29;
  if (triplets.some((meld) => meld.tile === seatTile)) {
    yaku.push(`自风 ${wind === 'east' ? '东' : '西'}`);
    han += 1;
  }
  for (const [tile, name] of [
    [31, '白'],
    [32, '发'],
    [33, '中'],
  ] as const) {
    if (triplets.some((meld) => meld.tile === tile)) {
      yaku.push(`役牌 ${name}`);
      han += 1;
    }
  }

  for (let rank = 0; rank <= 6; rank += 1) {
    if (
      [rank, rank + 9, rank + 18].every((start) => sequences.some((meld) => meld.tile === start))
    ) {
      yaku.push('三色同顺');
      han += 2;
      break;
    }
  }
  for (let rank = 0; rank < 9; rank += 1) {
    if ([rank, rank + 9, rank + 18].every((tile) => triplets.some((meld) => meld.tile === tile))) {
      yaku.push('三色同刻');
      han += 2;
      break;
    }
  }
  for (let suit = 0; suit < 3; suit += 1) {
    const base = suit * 9;
    if (
      [base, base + 3, base + 6].every((start) => sequences.some((meld) => meld.tile === start))
    ) {
      yaku.push('一气通贯');
      han += 2;
      break;
    }
  }
  const dragonTriplets = triplets.filter((meld) => meld.tile >= 31).length;
  if (dragonTriplets === 2 && form.pair >= 31) {
    yaku.push('小三元');
    han += 2;
  }

  const groups = [
    ...form.melds.map((meld) =>
      meld.kind === 'sequence' ? [meld.tile, meld.tile + 2] : [meld.tile],
    ),
    [form.pair],
  ];
  const everyGroupHasEdge = groups.every((group) =>
    group.some((tile) => tile >= 27 || isTerminal(tile)),
  );
  if (everyGroupHasEdge && sequences.length) {
    if (tiles.some((tile) => tile >= 27)) {
      yaku.push('混全带幺九');
      han += 2;
    } else {
      yaku.push('纯全带幺九');
      han += 3;
    }
  }

  let fu = 30;
  if (valuePair) fu += 2;
  for (const meld of triplets) fu += meld.tile >= 27 || isTerminal(meld.tile) ? 8 : 4;
  fu += waitFu(form, winningTile);
  fu = Math.ceil(fu / 10) * 10;
  return {
    han,
    fu,
    ...limitFor(han, fu),
    yaku,
    dora: common.doraCount,
    uraDora: common.uraDoraCount,
    winningTile,
  };
}

/**
 * 对荣和候选牌计番、计符并判定满贯档位；不够满贯时仍返回明细（tier 为 null）。
 * 非和牌结构返回 null；指示牌或自风等非法状态抛出 RuleEngineError。
 */
export function evaluateWin(
  hand: readonly TileType[],
  winningTile: TileType,
  indicator: TileType,
  wind: SeatWind,
  uraIndicator?: TileType,
): ScoreResult | null {
  assertTileType(winningTile);
  assertTileType(indicator);
  if (uraIndicator !== undefined) assertTileType(uraIndicator);
  if (wind !== 'east' && wind !== 'west')
    throw new RuleEngineError('INVALID_STATE', `Invalid seat wind: ${String(wind)}`);
  const tiles = [...hand, winningTile].sort((a, b) => a - b);
  if (!hand.every((tile) => Number.isInteger(tile) && tile >= 0 && tile < 34)) return null;
  const forms = decomposeHand(tiles);
  if (!isChiitoitsu(tiles) && !isKokushi(tiles) && forms.length === 0) return null;
  const yakuman = yakumanNames(tiles, forms);
  if (yakuman.length)
    return {
      han: 13,
      fu: 0,
      ...limitFor(13, 0, true),
      yaku: yakuman,
      dora: 0,
      uraDora: 0,
      winningTile,
    };
  const dora = doraFromIndicator(indicator);
  const uraDora = uraIndicator === undefined ? undefined : doraFromIndicator(uraIndicator);
  const candidates: ScoreResult[] = [];
  if (isChiitoitsu(tiles)) {
    const common = commonYaku(tiles, dora, uraDora);
    const han = common.han + 2;
    candidates.push({
      han,
      fu: 25,
      ...limitFor(han, 25),
      yaku: [...common.yaku, '七对子'],
      dora: common.doraCount,
      uraDora: common.uraDoraCount,
      winningTile,
    });
  }
  for (const form of forms)
    candidates.push(standardScore(tiles, form, winningTile, dora, wind, uraDora));
  return (
    candidates.sort((a, b) => b.multiplier - a.multiplier || b.han - a.han || b.fu - a.fu)[0] ??
    null
  );
}

/** 对每种听牌返回其牌种和当前指示牌条件下的计分结果。 */
export function describeWaits(
  hand: readonly TileType[],
  indicator: TileType,
  wind: SeatWind,
): { tile: TileType; score: ScoreResult | null }[] {
  const waits = waitTypes(hand);
  return waits.map((tile) => ({ tile, score: evaluateWin(hand, tile, indicator, wind) }));
}
