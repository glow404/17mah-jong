import { countTiles, waitTypes } from '../../lib/rules/hand';
import { isFuriten } from '../../lib/rules/furiten';
import { assertTileType, RuleEngineError } from '../../lib/rules/errors';
import { suggestTenpaiHand } from '../../lib/rules/selection';
import { createSeededRandom, shuffle, tileText, tileType } from '../../lib/rules/tiles';
import type { PhysicalTileId, RandomSource, SeatWind, TileType } from '../../lib/rules/types';

export type AiDifficulty = 'easy' | 'normal' | 'hard';

export interface AiHandAnalysis {
  shanten: number;
  waits: TileType[];
  ukeire: number;
}

export interface AiHandSelection {
  hand: PhysicalTileId[];
  analysis: AiHandAnalysis;
  reason: string;
}

export interface AiDiscardContext {
  hand: readonly TileType[];
  reserves: readonly PhysicalTileId[];
  ownDiscards: readonly TileType[];
  opponentDiscards: readonly TileType[];
  temporaryFuriten: boolean;
  indicator: TileType;
  wind: SeatWind;
}

export interface AiDiscardDecision {
  physicalId: PhysicalTileId;
  difficulty: AiDifficulty;
  elapsedMs: number;
  risk: number;
  reason: string;
  budgetExceeded: boolean;
}

export interface MahjongAi {
  readonly difficulty: AiDifficulty;
  selectHand(
    pool: readonly PhysicalTileId[],
    indicator: TileType,
    wind: SeatWind,
    random: RandomSource,
  ): AiHandSelection | null;
  chooseDiscard(
    context: AiDiscardContext,
    random: RandomSource,
    maxDecisionMs?: number,
  ): AiDiscardDecision;
}

const monotonicNow = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

/**
 * 估算 13 张门清手牌的向听数，支持标准形、七对子和国士无双。
 * 当前项目开局手牌固定为听牌，因此开局应为 0 向听；递归状态带 memo，避免重复拆分。
 */
export function calculateShanten(hand: readonly TileType[]): number {
  if (hand.length !== 13) return Infinity;
  const counts = countTiles(hand);
  if (counts.some((count) => count > 4)) return Infinity;

  const memo = new Map<string, number>();
  const standard = (melds: number, taatsu: number, pair: number): number => {
    const first = counts.findIndex((count) => count > 0);
    if (first < 0) {
      const usefulTaatsu = Math.min(taatsu, 4 - melds);
      return 8 - melds * 2 - usefulTaatsu - pair;
    }
    const key = `${counts.join('')}:${melds}:${taatsu}:${pair}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let best = Infinity;
    const visit = (
      tiles: readonly number[],
      nextMelds: number,
      nextTaatsu: number,
      nextPair: number,
    ) => {
      for (const tile of tiles) counts[tile] -= 1;
      best = Math.min(best, standard(nextMelds, nextTaatsu, nextPair));
      for (const tile of tiles) counts[tile] += 1;
    };

    visit([first], melds, taatsu, pair);
    if (melds < 4 && counts[first] >= 3) visit([first, first, first], melds + 1, taatsu, pair);
    if (melds < 4 && first < 27 && first % 9 <= 6 && counts[first + 1] && counts[first + 2])
      visit([first, first + 1, first + 2], melds + 1, taatsu, pair);
    if (!pair && counts[first] >= 2) visit([first, first], melds, taatsu, 1);
    if (taatsu < 4 && counts[first] >= 2) visit([first, first], melds, taatsu + 1, pair);
    if (taatsu < 4 && first < 27 && first % 9 <= 7 && counts[first + 1])
      visit([first, first + 1], melds, taatsu + 1, pair);
    if (taatsu < 4 && first < 27 && first % 9 <= 6 && counts[first + 2])
      visit([first, first + 2], melds, taatsu + 1, pair);
    memo.set(key, best);
    return best;
  };

  const standardShanten = standard(0, 0, 0);
  const pairs = counts.filter((count) => count >= 2).length;
  const distinct = counts.filter((count) => count > 0).length;
  const chiitoitsu = 6 - pairs + Math.max(0, 7 - distinct);
  const terminals = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
  const orphanKinds = terminals.filter((tile) => counts[tile] > 0).length;
  const kokushi = 13 - orphanKinds - (terminals.some((tile) => counts[tile] > 1) ? 1 : 0);
  return Math.min(standardShanten, chiitoitsu, kokushi);
}

/** 统计某一听牌手牌的等待种类及全副牌中尚未被手牌占用的有效枚数。 */
export function analyzeTenpaiHand(hand: readonly TileType[]): AiHandAnalysis {
  const waits = waitTypes(hand);
  const counts = countTiles(hand);
  return {
    shanten: calculateShanten(hand),
    waits,
    ukeire: waits.reduce((total, tile) => total + 4 - counts[tile], 0),
  };
}

function selectHand(
  difficulty: AiDifficulty,
  pool: readonly PhysicalTileId[],
  indicator: TileType,
  wind: SeatWind,
  random: RandomSource,
): AiHandSelection | null {
  // Easy mode randomizes equivalent physical copies; all modes keep the opening deal
  // valid and at least tenpai so that every match can produce a ron.
  const hand = suggestTenpaiHand(
    difficulty === 'easy' ? shuffle(pool, random) : pool,
    indicator,
    wind,
    random,
  );
  if (!hand) return null;
  const analysis = analyzeTenpaiHand(hand.map(tileType));
  return {
    hand,
    analysis,
    reason: `开局手牌为 ${analysis.shanten} 向听，${analysis.waits.length} 种等待、约 ${analysis.ukeire} 枚有效牌。`,
  };
}

function tileBaseRisk(tile: TileType, indicator: TileType): number {
  if (tile >= 27) return tile === indicator ? 1.2 : 0.72;
  const rank = tile % 9;
  const edgeDistance = Math.min(rank, 8 - rank);
  const shapeRisk = edgeDistance === 0 ? 0.68 : edgeDistance === 1 ? 0.78 : 1;
  return tile === indicator ? shapeRisk * 1.18 : shapeRisk;
}

function hasSujiEvidence(tile: TileType, river: readonly TileType[]): boolean {
  if (tile >= 27) return false;
  const rank = tile % 9;
  return river.some((discard) => {
    if (discard >= 27 || Math.floor(discard / 9) !== Math.floor(tile / 9)) return false;
    const discardRank = discard % 9;
    return Math.abs(rank - discardRank) === 3;
  });
}

/**
 * 基于公开河牌估算对手已振听概率和单张放铳风险。
 * 这是娱乐级启发式，不声称等价于雀魂的防守 AI，也不会读取对手暗手。
 */
export function estimateDealInRisk(
  tile: TileType,
  opponentDiscards: readonly TileType[],
  indicator: TileType,
): { risk: number; furitenProbability: number; signals: string[] } {
  assertTileType(tile);
  assertTileType(indicator);
  const riverCounts = countTiles(opponentDiscards);
  const uniqueRiverTypes = riverCounts.filter((count) => count > 0).length;
  const furitenProbability = 1 - (1 - uniqueRiverTypes / 34) ** 2;
  const remainingCopies = 4 - riverCounts[tile];
  let risk = tileBaseRisk(tile, indicator) * (remainingCopies / 4) * (1 - furitenProbability);
  const signals: string[] = [];
  if (riverCounts[tile] > 0) {
    risk *= 0.55;
    signals.push(`对手河牌已有 ${riverCounts[tile]} 张同种牌`);
  }
  if (hasSujiEvidence(tile, opponentDiscards)) {
    risk *= 0.72;
    signals.push('同色筋线索降低估算风险');
  }
  if (tile === indicator) signals.push('这是宝牌，估算危险度上调');
  if (uniqueRiverTypes > 0)
    signals.push(`按公开河牌估算对手振听概率 ${Math.round(furitenProbability * 100)}%`);
  return { risk: Math.max(0, risk), furitenProbability, signals };
}

function normalRisk(tile: TileType, indicator: TileType): number {
  return tileBaseRisk(tile, indicator);
}

function chooseDiscard(
  difficulty: AiDifficulty,
  context: AiDiscardContext,
  random: RandomSource,
  maxDecisionMs = 20,
): AiDiscardDecision {
  const started = monotonicNow();
  const legal = context.reserves;
  if (legal.length === 0)
    throw new RuleEngineError('INVALID_STATE', 'AI cannot discard from an empty reserve');
  const budget = Number.isFinite(maxDecisionMs) ? Math.max(0, maxDecisionMs) : 20;
  const deadline = started + budget;
  const randomUnit = () => {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new RuleEngineError(
        'INVALID_RANDOM_VALUE',
        'Random source must return a value in [0, 1)',
      );
    return value;
  };
  const randomIndex = () => Math.min(legal.length - 1, Math.floor(randomUnit() * legal.length));

  if (difficulty === 'easy') {
    const physicalId = legal[randomIndex()];
    const budgetExceeded = monotonicNow() >= deadline;
    return {
      physicalId,
      difficulty,
      elapsedMs: Math.max(0, monotonicNow() - started),
      risk: estimateDealInRisk(tileType(physicalId), context.opponentDiscards, context.indicator)
        .risk,
      reason: budgetExceeded
        ? '简单难度：超过思考时间上限，回退到合法随机出牌。'
        : '简单难度：从剩余合法牌中随机选择。',
      budgetExceeded,
    };
  }

  let best = legal[0];
  let bestRisk = Infinity;
  let bestPriority = Infinity;
  let bestSignals: string[] = [];
  let budgetExceeded = false;
  const alreadyFuriten = isFuriten(context.hand, context.ownDiscards, context.temporaryFuriten);
  const ownWaits = new Set(waitTypes(context.hand));
  for (const candidate of legal) {
    if (monotonicNow() >= deadline) {
      budgetExceeded = true;
      break;
    }
    const tile = tileType(candidate);
    const estimate =
      difficulty === 'hard'
        ? estimateDealInRisk(tile, context.opponentDiscards, context.indicator)
        : { risk: normalRisk(tile, context.indicator), signals: [] };
    const breaksOwnWait = !alreadyFuriten && ownWaits.has(tile);
    const priority = estimate.risk + (breaksOwnWait ? 2 : 0);
    const signals = breaksOwnWait
      ? [...estimate.signals, '避免打出自家等待牌，降低永久振听风险']
      : estimate.signals;
    if (priority < bestPriority) {
      best = candidate;
      bestRisk = estimate.risk;
      bestPriority = priority;
      bestSignals = signals;
    } else if (priority === bestPriority && randomUnit() < 0.5) {
      best = candidate;
      bestRisk = estimate.risk;
      bestSignals = signals;
    }
  }
  if (budgetExceeded) {
    best = legal[randomIndex()];
    bestRisk = estimateDealInRisk(tileType(best), context.opponentDiscards, context.indicator).risk;
    bestSignals = ['达到思考时间上限，回退到合法随机出牌'];
  }
  if (
    !budgetExceeded &&
    !alreadyFuriten &&
    !ownWaits.has(tileType(best)) &&
    legal.some((candidate) => ownWaits.has(tileType(candidate)))
  )
    bestSignals.push('保留自家等待牌，避免打出等待牌导致永久振听');
  const tile = tileType(best);
  const handAnalysis = analyzeTenpaiHand(context.hand);
  const ownFuriten = isFuriten(context.hand, context.ownDiscards, context.temporaryFuriten);
  const reason =
    difficulty === 'hard'
      ? `己方${ownFuriten ? '已振听' : '未振听'}；${bestSignals.length ? `${bestSignals.join('；')}；` : ''}估算放铳风险 ${(bestRisk * 100).toFixed(0)}%；开局手牌 ${handAnalysis.shanten} 向听、${handAnalysis.ukeire} 枚有效牌。`
      : `按基础危险度选择舍出 ${tileText(tile)}；${bestSignals.length ? `${bestSignals.join('；')}；` : ''}开局手牌 ${handAnalysis.shanten} 向听、${handAnalysis.ukeire} 枚有效牌。`;
  return {
    physicalId: best,
    difficulty,
    elapsedMs: Math.max(0, monotonicNow() - started),
    risk: bestRisk,
    reason,
    budgetExceeded,
  };
}

function makeAi(difficulty: AiDifficulty): MahjongAi {
  return {
    difficulty,
    selectHand: (pool, indicator, wind, random) =>
      selectHand(difficulty, pool, indicator, wind, random),
    chooseDiscard: (context, random, maxDecisionMs) =>
      chooseDiscard(difficulty, context, random, maxDecisionMs),
  };
}

/** 三档电脑策略的统一入口，决策和手牌选择均可注入随机源以便复现。 */
export const mahjongAi: Readonly<Record<AiDifficulty, MahjongAi>> = {
  easy: makeAi('easy'),
  normal: makeAi('normal'),
  hard: makeAi('hard'),
};

/** 以固定种子和巡数派生独立随机流，刷新/重放时得到相同的电脑决策。 */
export function aiRandomForTurn(seed: number, turnIndex: number): RandomSource {
  const turnSeed = (seed + Math.imul(turnIndex + 1, 0x9e3779b1)) >>> 0;
  return createSeededRandom(turnSeed);
}

/** 判断物理牌是否包含在本次决策允许打出的牌中。 */
export function isLegalAiDiscard(id: number, reserves: readonly PhysicalTileId[]): boolean {
  return reserves.includes(id);
}
