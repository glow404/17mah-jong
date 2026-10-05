import type { GameResult } from '../../lib/contracts/mahjong';
import type { AiDifficulty } from './ai';

const STORAGE_KEY = '17mah-jong:ai-stats:v1';

export interface DifficultyStats {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  totalDurationMs: number;
  totalDecisionMs: number;
  decisions: number;
}

export type AiStats = Record<AiDifficulty, DifficultyStats>;

export const emptyAiStats = (): AiStats => ({
  easy: emptyDifficultyStats(),
  normal: emptyDifficultyStats(),
  hard: emptyDifficultyStats(),
});

function emptyDifficultyStats(): DifficultyStats {
  return {
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    totalDurationMs: 0,
    totalDecisionMs: 0,
    decisions: 0,
  };
}

function isDifficultyStats(value: unknown): value is DifficultyStats {
  if (!value || typeof value !== 'object') return false;
  const stats = value as Record<string, unknown>;
  return [
    'matches',
    'wins',
    'losses',
    'draws',
    'totalDurationMs',
    'totalDecisionMs',
    'decisions',
  ].every((field) => Number.isSafeInteger(stats[field]) && Number(stats[field]) >= 0);
}

/** 验证并规范化浏览器本地保存的 AI 对战统计。 */
export function parseAiStats(value: unknown): AiStats {
  if (!value || typeof value !== 'object') return emptyAiStats();
  const source = value as Record<string, unknown>;
  if (
    !isDifficultyStats(source.easy) ||
    !isDifficultyStats(source.normal) ||
    !isDifficultyStats(source.hard)
  )
    return emptyAiStats();
  return {
    easy: { ...source.easy },
    normal: { ...source.normal },
    hard: { ...source.hard },
  };
}

/** 将一局电脑对战结果加入指定难度的累计统计，返回新对象，不修改入参。 */
export function addAiMatch(
  stats: AiStats,
  difficulty: AiDifficulty,
  result: GameResult,
  durationMs: number,
  decisionMs: number,
  decisions: number,
): AiStats {
  const validDuration = Math.max(0, Math.round(durationMs));
  const validDecisionTime = Math.max(0, Math.round(decisionMs));
  const validDecisions = Math.max(0, Math.round(decisions));
  const current = stats[difficulty];
  const wins = current.wins + (result.kind === 'ron' && result.winner === 1 ? 1 : 0);
  const losses = current.losses + (result.kind === 'ron' && result.winner === 0 ? 1 : 0);
  const draws = current.draws + (result.kind === 'draw' ? 1 : 0);
  return {
    ...stats,
    [difficulty]: {
      matches: current.matches + 1,
      wins,
      losses,
      draws,
      totalDurationMs: current.totalDurationMs + validDuration,
      totalDecisionMs: current.totalDecisionMs + validDecisionTime,
      decisions: current.decisions + validDecisions,
    },
  };
}

/** 从 localStorage 读取匿名、仅本机保存的电脑对战统计。 */
export function loadAiStats(): AiStats {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? parseAiStats(JSON.parse(raw) as unknown) : emptyAiStats();
  } catch {
    return emptyAiStats();
  }
}

/** 保存累计统计；不可用或被浏览器禁用存储时静默降级，不影响牌局。 */
export function saveAiStats(stats: AiStats): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // Metrics are best-effort and must never block game completion.
  }
}

/** 将一局本地电脑对战追加到浏览器统计。 */
export function recordAiMatch(
  difficulty: AiDifficulty,
  result: GameResult,
  durationMs: number,
  decisionMs: number,
  decisions: number,
): AiStats {
  const next = addAiMatch(loadAiStats(), difficulty, result, durationMs, decisionMs, decisions);
  saveAiStats(next);
  return next;
}

/** 计算按对局加权的平均用时与平均单次 AI 决策耗时。 */
export function summarizeDifficulty(stats: DifficultyStats): {
  winRate: number;
  averageDurationMs: number;
  averageDecisionMs: number;
} {
  return {
    winRate: stats.matches ? stats.wins / stats.matches : 0,
    averageDurationMs: stats.matches ? stats.totalDurationMs / stats.matches : 0,
    averageDecisionMs: stats.decisions ? stats.totalDecisionMs / stats.decisions : 0,
  };
}
