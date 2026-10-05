import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aiRandomForTurn,
  analyzeTenpaiHand,
  calculateShanten,
  estimateDealInRisk,
  mahjongAi,
} from '../app/game/ai';
import { addAiMatch, emptyAiStats, parseAiStats, summarizeDifficulty } from '../app/game/aiStats';
import { evaluateWin } from '../lib/rules/scoring';
import { createSeededRandom } from '../lib/rules/tiles';
import { AI_BENCHMARKS } from './fixtures/ai-benchmarks';

const tenpaiHand = [0, 1, 2, 9, 10, 11, 18, 19, 20, 27, 27, 27, 31];

function context(reserves: number[], opponentDiscards: number[] = []) {
  return {
    hand: tenpaiHand,
    reserves,
    ownDiscards: [],
    opponentDiscards,
    temporaryFuriten: false,
    indicator: 5,
    wind: 'west' as const,
  };
}

test('AI opening hand analysis reports tenpai, waits, and remaining effective copies', () => {
  assert.equal(calculateShanten(tenpaiHand), 0);
  assert.deepEqual(analyzeTenpaiHand(tenpaiHand), { shanten: 0, waits: [31], ukeire: 3 });
});

test('AI hand selection is reproducible and keeps every opening wait mangan-or-better', () => {
  const types = [
    ...Array(3).fill([0, 1, 2]).flat(),
    ...Array(3).fill([18, 19, 20]).flat(),
    27,
    27,
    28,
    28,
    31,
    31,
    32,
  ];
  const used = new Map<number, number>();
  const pool = types.map((tile) => {
    const copy = used.get(tile) ?? 0;
    used.set(tile, copy + 1);
    return tile * 4 + copy;
  });
  const first = mahjongAi.hard.selectHand(pool, 0, 'east', createSeededRandom(1234));
  const repeat = mahjongAi.hard.selectHand(pool, 0, 'east', createSeededRandom(1234));
  assert.ok(first);
  assert.deepEqual(first, repeat);
  assert.equal(first.analysis.shanten, 0);
  assert.ok(
    first.analysis.waits.every(
      (tile) =>
        evaluateWin(
          first.hand.map((id) => Math.floor(id / 4)),
          tile,
          0,
          'east',
        )?.tier,
    ),
  );
});

test('easy AI always chooses a legal reserve and reproduces its choice from a fixed seed', () => {
  const first = mahjongAi.easy.chooseDiscard(context([0, 16, 21]), aiRandomForTurn(7123, 2));
  const repeat = mahjongAi.easy.chooseDiscard(context([0, 16, 21]), aiRandomForTurn(7123, 2));
  assert.equal(first.physicalId, repeat.physicalId);
  assert.ok([0, 16, 21].includes(first.physicalId));
});

test('normal AI favors lower structural danger and keeps the effective-tile analysis visible', () => {
  const decision = mahjongAi.normal.chooseDiscard(context([0, 16]), () => 0.5, 1000);
  assert.equal(decision.physicalId, 0);
  assert.match(decision.reason, /0 向听/);
  assert.match(decision.reason, /3 枚有效牌/);
});

test('normal and hard AI preserve an un-discarded own wait to avoid permanent furiten', () => {
  for (const difficulty of ['normal', 'hard'] as const) {
    const decision = mahjongAi[difficulty].chooseDiscard(context([124, 16]), () => 0.5, 1000);
    assert.equal(decision.physicalId, 16);
    assert.match(decision.reason, /永久振听/);
  }
});

test('hard AI regression benchmark favors the observed low-risk and suji signals', () => {
  for (const fixture of AI_BENCHMARKS) {
    if (!('expectedHardTile' in fixture)) continue;
    const decision = mahjongAi.hard.chooseDiscard(
      context([...fixture.reserveIds], [...fixture.opponentDiscards]),
      () => 0.5,
      1000,
    );
    assert.equal(decision.physicalId, fixture.expectedHardTile, fixture.id);
  }
});

test('normal AI benchmark prefers an edge tile over an unmarked middle tile', () => {
  const fixture = AI_BENCHMARKS.find((item) => 'expectedNormalTile' in item);
  assert.ok(fixture);
  const decision = mahjongAi.normal.chooseDiscard(
    context([...fixture.reserveIds], [...fixture.opponentDiscards]),
    () => 0.5,
    1000,
  );
  assert.equal(decision.physicalId, fixture.expectedNormalTile);
});

test('hard risk estimator reduces estimated deal-in risk for public safety evidence', () => {
  const open = estimateDealInRisk(4, [], 5);
  const sameTile = estimateDealInRisk(4, [4], 5);
  const suji = estimateDealInRisk(4, [1], 5);
  assert.ok(sameTile.risk < open.risk);
  assert.ok(suji.risk < open.risk);
  assert.ok(
    estimateDealInRisk(4, [0, 1, 2, 3, 5, 6, 7, 8], 5).furitenProbability > open.furitenProbability,
  );
});

test('hard AI reports exact self-furiten without inspecting the opponent hand', () => {
  const decision = mahjongAi.hard.chooseDiscard(
    { ...context([0, 16]), ownDiscards: [31] },
    () => 0.5,
    1000,
  );
  assert.match(decision.reason, /己方已振听/);
});

test('AI decision budget has a legal random fallback', () => {
  const decision = mahjongAi.hard.chooseDiscard(context([0, 16]), () => 0.9, 0);
  assert.ok([0, 16].includes(decision.physicalId));
  assert.equal(decision.budgetExceeded, true);
  assert.match(decision.reason, /时间上限/);
  const easyDecision = mahjongAi.easy.chooseDiscard(context([0, 16]), () => 0.1, 0);
  assert.ok([0, 16].includes(easyDecision.physicalId));
  assert.equal(easyDecision.budgetExceeded, true);
});

test('AI statistics aggregate wins, match duration, and decision latency by difficulty', () => {
  const result = {
    kind: 'ron' as const,
    winner: 1 as const,
    payment: 7500,
    score: {
      han: 5,
      fu: 30,
      tier: '满贯' as const,
      multiplier: 1 as const,
      yaku: ['两立直'],
      dora: 0,
      uraDora: 0,
      winningTile: 31,
    },
  };
  const stats = addAiMatch(emptyAiStats(), 'normal', result, 120_000, 5, 10);
  assert.equal(stats.normal.wins, 1);
  assert.deepEqual(summarizeDifficulty(stats.normal), {
    winRate: 1,
    averageDurationMs: 120_000,
    averageDecisionMs: 0.5,
  });
  assert.deepEqual(parseAiStats({ normal: stats.normal }), emptyAiStats());
});
