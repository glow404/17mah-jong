/**
 * 麻将规则与计分核心。
 *
 * 牌使用 0 到 33 的逻辑编号表示一张牌种类；实体牌墙使用 0 到 135
 * 的物理编号，并通过 tileType() 映射回牌种类。模块先生成牌墙和计算
 * 宝牌，再判断听牌，最后进行牌型拆解、役种识别、番符计算和满贯判断。
 */
export type SeatWind = 'east' | 'west';
export type LimitTier = '满贯' | '跳满' | '倍满' | '三倍满' | '役满';

export interface ScoreResult {
  han: number;
  fu: number;
  tier: LimitTier | null;
  multiplier: 0 | 1 | 1.5 | 2 | 3 | 4;
  yaku: string[];
  dora: number;
  uraDora: number;
  winningTile: number;
}

type Meld = { kind: 'sequence' | 'triplet'; tile: number };
type Decomposition = { pair: number; melds: Meld[] };

const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HONORS = ['东', '南', '西', '北', '白', '发', '中'];
const ORPHANS = new Set([0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]);

export function tileType(physicalId: number) {
  // 标准麻将每种牌有四张，实体编号每四个归属于同一个牌种。
  return Math.floor(physicalId / 4);
}

export function tileLabel(tile: number) {
  if (tile >= 27)
    return { main: HONORS[tile - 27], suit: '', kind: tile >= 31 ? 'dragon' : 'wind' };
  const suitIndex = Math.floor(tile / 9);
  return {
    main: NUMERALS[tile % 9],
    suit: ['万', '筒', '索'][suitIndex],
    kind: ['man', 'pin', 'sou'][suitIndex],
  };
}

export function tileText(tile: number) {
  const label = tileLabel(tile);
  return `${label.main}${label.suit}`;
}

export function tileGlyph(tile: number) {
  if (tile < 9) return String.fromCodePoint(0x1f007 + tile);
  if (tile < 18) return String.fromCodePoint(0x1f019 + tile - 9);
  if (tile < 27) return String.fromCodePoint(0x1f010 + tile - 18);
  const honorPoints = [0x1f000, 0x1f001, 0x1f002, 0x1f003, 0x1f006, 0x1f005, 0x1f004];
  return String.fromCodePoint(honorPoints[tile - 27]);
}

export function sortTiles<T extends number>(tiles: T[]) {
  return [...tiles].sort((a, b) => tileType(a) - tileType(b) || a - b);
}

export function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

export function createWall() {
  // 保留实体编号，选牌和舍牌时可以区分四张相同牌种的实体牌。
  return shuffle(Array.from({ length: 136 }, (_, index) => index));
}

export function doraFromIndicator(indicator: number) {
  if (indicator < 27) {
    const suit = Math.floor(indicator / 9) * 9;
    return suit + (((indicator % 9) + 1) % 9);
  }
  if (indicator <= 30) return 27 + ((indicator - 27 + 1) % 4);
  return 31 + ((indicator - 31 + 1) % 3);
}

function countsOf(tiles: number[]) {
  const counts = Array(34).fill(0) as number[];
  tiles.forEach((tile) => {
    counts[tile] += 1;
  });
  return counts;
}

function isSequenceStart(tile: number) {
  return tile < 27 && tile % 9 <= 6;
}

function collectMelds(counts: number[], melds: Meld[], result: Meld[][]) {
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
  if (isSequenceStart(tile) && counts[tile + 1] && counts[tile + 2]) {
    counts[tile] -= 1;
    counts[tile + 1] -= 1;
    counts[tile + 2] -= 1;
    collectMelds(counts, [...melds, { kind: 'sequence', tile }], result);
    counts[tile] += 1;
    counts[tile + 1] += 1;
    counts[tile + 2] += 1;
  }
}

function decompositions(tiles: number[]) {
  // 依次尝试每一种对子，再递归拆出四组顺子或刻子。
  const result: Decomposition[] = [];
  const counts = countsOf(tiles);
  for (let pair = 0; pair < 34; pair += 1) {
    if (counts[pair] < 2) continue;
    counts[pair] -= 2;
    const meldLists: Meld[][] = [];
    collectMelds(counts, [], meldLists);
    meldLists.forEach((melds) => result.push({ pair, melds }));
    counts[pair] += 2;
  }
  return result;
}

function isChiitoitsu(tiles: number[]) {
  const counts = countsOf(tiles);
  return counts.filter((count) => count === 2).length === 7;
}

function isKokushi(tiles: number[]) {
  const counts = countsOf(tiles);
  return (
    [...ORPHANS].every((tile) => counts[tile] >= 1) &&
    [...ORPHANS].some((tile) => counts[tile] >= 2)
  );
}

export function isWinningHand(tiles: number[]) {
  if (tiles.length !== 14) return false;
  return isChiitoitsu(tiles) || isKokushi(tiles) || decompositions(tiles).length > 0;
}

export function waitTypes(hand: number[]) {
  // 枚举可能摸到的牌，并复用完整和牌判断得到所有听牌。
  if (hand.length !== 13) return [];
  const counts = countsOf(hand);
  const waits: number[] = [];
  for (let tile = 0; tile < 34; tile += 1) {
    if (counts[tile] < 4 && isWinningHand([...hand, tile])) waits.push(tile);
  }
  return waits;
}

function limitFor(
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

function isSimple(tile: number) {
  return tile < 27 && tile % 9 > 0 && tile % 9 < 8;
}

function isTerminal(tile: number) {
  return tile < 27 && (tile % 9 === 0 || tile % 9 === 8);
}

function flushYaku(tiles: number[]) {
  const suits = new Set(tiles.filter((tile) => tile < 27).map((tile) => Math.floor(tile / 9)));
  if (suits.size !== 1) return null;
  return tiles.some((tile) => tile >= 27) ? { name: '混一色', han: 3 } : { name: '清一色', han: 6 };
}

function commonYaku(tiles: number[], dora: number, uraDora?: number) {
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

function yakumanNames(tiles: number[], forms: Decomposition[]) {
  if (isKokushi(tiles)) return ['国士无双'];
  const names: string[] = [];
  if (tiles.every((tile) => tile >= 27)) names.push('字一色');
  if (tiles.every(isTerminal)) names.push('清老头');
  const green = new Set([19, 20, 21, 23, 25, 32]);
  if (tiles.every((tile) => green.has(tile))) names.push('绿一色');
  const counts = countsOf(tiles);
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

function waitFu(form: Decomposition, winningTile: number) {
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
  tiles: number[],
  form: Decomposition,
  winningTile: number,
  dora: number,
  wind: SeatWind,
  uraDora?: number,
): ScoreResult {
  // 普通四组牌加对子：先算通用役和宝牌，再根据具体拆法计算役、符和等级。
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
  [
    [31, '白'],
    [32, '发'],
    [33, '中'],
  ].forEach(([tile, name]) => {
    if (triplets.some((meld) => meld.tile === tile)) {
      yaku.push(`役牌 ${name}`);
      han += 1;
    }
  });

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
  triplets.forEach((meld) => {
    fu += meld.tile >= 27 || isTerminal(meld.tile) ? 8 : 4;
  });
  fu += waitFu(form, winningTile);
  fu = Math.ceil(fu / 10) * 10;
  const limit = limitFor(han, fu);
  return {
    han,
    fu,
    ...limit,
    yaku,
    dora: common.doraCount,
    uraDora: common.uraDoraCount,
    winningTile,
  };
}

export function evaluateWin(
  hand: number[],
  winningTile: number,
  indicator: number,
  wind: SeatWind,
  uraIndicator?: number,
): ScoreResult | null {
  const tiles = [...hand, winningTile].sort((a, b) => a - b);
  if (!isWinningHand(tiles)) return null;
  const forms = decompositions(tiles);
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
  forms.forEach((form) =>
    candidates.push(standardScore(tiles, form, winningTile, dora, wind, uraDora)),
  );
  return (
    candidates.sort((a, b) => b.multiplier - a.multiplier || b.han - a.han || b.fu - a.fu)[0] ??
    null
  );
}

function physicalSelection(pool: number[], wantedTypes: number[]) {
  const buckets = new Map<number, number[]>();
  pool.forEach((id) => {
    const type = tileType(id);
    buckets.set(type, [...(buckets.get(type) ?? []), id]);
  });
  const selection: number[] = [];
  for (const type of wantedTypes) {
    const id = buckets.get(type)?.shift();
    if (id === undefined) return null;
    selection.push(id);
  }
  return sortTiles(selection);
}

export function suggestTenpaiHand(pool: number[], indicator: number, wind: SeatWind) {
  const poolCounts = countsOf(pool.map(tileType));
  let best: { types: number[]; rank: number } | null = null;
  let considered = 0;
  const seen = new Set<string>();

  const consider = (types: number[]) => {
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
      .filter(Boolean) as ScoreResult[];
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

  const search = (allowed: (tile: number) => boolean, budget: number) => {
    const meldOptions: Meld[] = [];
    for (let tile = 0; tile < 34; tile += 1) {
      if (!allowed(tile)) continue;
      if (poolCounts[tile] >= 3) meldOptions.push({ kind: 'triplet', tile });
      if (
        isSequenceStart(tile) &&
        allowed(tile + 1) &&
        allowed(tile + 2) &&
        poolCounts[tile] &&
        poolCounts[tile + 1] &&
        poolCounts[tile + 2]
      )
        meldOptions.push({ kind: 'sequence', tile });
    }
    const taatsu: number[][] = [];
    for (let tile = 0; tile < 34; tile += 1) {
      if (!allowed(tile)) continue;
      if (poolCounts[tile] >= 2) taatsu.push([tile, tile]);
      if (
        tile < 27 &&
        tile % 9 <= 7 &&
        allowed(tile + 1) &&
        poolCounts[tile] &&
        poolCounts[tile + 1]
      )
        taatsu.push([tile, tile + 1]);
      if (
        tile < 27 &&
        tile % 9 <= 6 &&
        allowed(tile + 2) &&
        poolCounts[tile] &&
        poolCounts[tile + 2]
      )
        taatsu.push([tile, tile + 2]);
    }
    const remaining = [...poolCounts];
    const chosen: number[] = [];
    const startCount = considered;
    const applyMeld = (option: Meld, delta: number) => {
      const tiles =
        option.kind === 'triplet'
          ? [option.tile, option.tile, option.tile]
          : [option.tile, option.tile + 1, option.tile + 2];
      tiles.forEach((tile) => {
        remaining[tile] += delta;
      });
      return tiles;
    };
    const walk = (depth: number, from: number) => {
      if (considered - startCount >= budget || considered >= 5200) return;
      if (depth === 3) {
        for (let pair = 0; pair < 34; pair += 1) {
          if (!allowed(pair) || remaining[pair] < 2) continue;
          remaining[pair] -= 2;
          for (const shape of taatsu) {
            if (
              shape.every(
                (tile, index) =>
                  remaining[tile] >=
                  shape.slice(0, index + 1).filter((value) => value === tile).length,
              )
            ) {
              consider([...chosen, pair, pair, ...shape]);
              if (considered - startCount >= budget) break;
            }
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
        const need = countsOf(tiles);
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
  const winningTypes = best ? (best as { types: number[]; rank: number }).types : null;
  return winningTypes ? physicalSelection(pool, winningTypes) : null;
}

export function isFuriten(hand: number[], ownDiscards: number[], temporary: boolean) {
  if (temporary) return true;
  const waits = new Set(waitTypes(hand));
  return ownDiscards.some((tile) => waits.has(tile));
}

export function describeWaits(hand: number[], indicator: number, wind: SeatWind) {
  return waitTypes(hand).map((tile) => ({ tile, score: evaluateWin(hand, tile, indicator, wind) }));
}
