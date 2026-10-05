import { performance } from 'node:perf_hooks';
import { evaluateWin, waitTypes } from '../lib/rules';

const iterations = Math.max(100, Number(process.env.PERF_ITERATIONS ?? 2_000));
const hand = [0, 1, 2, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8];
const winningHand = [...hand, 8];

function percentile(values: number[], ratio: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)];
}

function benchmark(name: string, operation: () => unknown) {
  for (let index = 0; index < 100; index += 1) operation();
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    operation();
    samples.push((performance.now() - start) * 1_000);
  }
  return {
    operation: name,
    iterations,
    unit: 'microseconds',
    p50: Number(percentile(samples, 0.5).toFixed(2)),
    p95: Number(percentile(samples, 0.95).toFixed(2)),
    p99: Number(percentile(samples, 0.99).toFixed(2)),
  };
}

const report = {
  benchmark: '17mah-jong rules engine (local process; not a production SLO)',
  node: process.version,
  results: [
    benchmark('waitTypes(13-tile hand)', () => waitTypes(hand)),
    benchmark('evaluateWin(14-tile hand)', () => evaluateWin(hand, 8, 12, 'east', 8)),
    benchmark('evaluateWin(14-tile winning hand)', () =>
      evaluateWin(winningHand, 8, 12, 'east', 8),
    ),
  ],
};

console.log(JSON.stringify(report, null, 2));
