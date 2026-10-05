import { performance } from 'node:perf_hooks';
import { aiRandomForTurn, mahjongAi, type AiDifficulty } from '../app/game/ai';
import { localGameReducer, type LocalGame } from '../app/game/localGameReducer';
import { createSeededRandom, createWall, sortTiles, tileType } from '../lib/rules/tiles';

const DIFFICULTIES: AiDifficulty[] = ['easy', 'normal', 'hard'];
const PAIRINGS: Array<[AiDifficulty, AiDifficulty]> = [
  ['easy', 'normal'],
  ['normal', 'hard'],
  ['easy', 'hard'],
];
const DEFAULT_SEEDS = [17, 31, 47, 61, 83, 101, 127, 149, 173, 197, 223, 251];

interface SimulatedMatch {
  winner: 0 | 1 | null;
  durationMs: number;
  decisionMs: number;
  decisions: number;
}

function makeStartingState(
  seed: number,
  difficulties: [AiDifficulty, AiDifficulty],
): LocalGame | null {
  const random = createSeededRandom(seed);
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const wall = createWall(random);
    const pools: [number[], number[]] = [wall.slice(0, 34), wall.slice(34, 68)];
    const indicator = tileType(wall[68]);
    const hands = [
      mahjongAi[difficulties[0]].selectHand(pools[0], indicator, 'east', random)?.hand ?? null,
      mahjongAi[difficulties[1]].selectHand(pools[1], indicator, 'west', random)?.hand ?? null,
    ] as const;
    if (!hands[0] || !hands[1]) continue;
    const selected = [new Set(hands[0]), new Set(hands[1])] as const;
    return {
      hands: [
        hands[0].map(tileType).sort((a, b) => a - b),
        hands[1].map(tileType).sort((a, b) => a - b),
      ],
      reserves: [
        sortTiles(pools[0].filter((id) => !selected[0].has(id))),
        sortTiles(pools[1].filter((id) => !selected[1].has(id))),
      ],
      discards: [[], []],
      counts: [0, 0],
      temporaryFuriten: [false, false],
      indicator,
      uraIndicator: tileType(wall[69]),
      turn: 0,
      pendingRon: null,
      pendingScore: null,
      lastDiscard: null,
      result: null,
    };
  }
  return null;
}

function simulateMatch(seed: number, difficulties: [AiDifficulty, AiDifficulty]): SimulatedMatch {
  const started = performance.now();
  const initial = makeStartingState(seed, difficulties);
  if (!initial)
    return { winner: null, durationMs: performance.now() - started, decisionMs: 0, decisions: 0 };
  let state = localGameReducer(null, { type: 'start', game: initial });
  let decisionMs = 0;
  let decisions = 0;
  let actions = 0;
  while (state && !state.result && actions < 36) {
    if (state.pendingRon !== null) {
      state = localGameReducer(
        state,
        state.pendingRon === 0
          ? { type: 'ron', baseScore: 5000 }
          : { type: 'cpu-ron', baseScore: 5000 },
      );
    } else {
      const seat = state.turn;
      const ai = mahjongAi[difficulties[seat]];
      const decision = ai.chooseDiscard(
        {
          hand: state.hands[seat],
          reserves: state.reserves[seat],
          ownDiscards: state.discards[seat],
          opponentDiscards: state.discards[1 - seat],
          temporaryFuriten: state.temporaryFuriten[seat],
          indicator: state.indicator,
          wind: seat === 0 ? 'east' : 'west',
        },
        aiRandomForTurn(seed + seat * 1_000_003, state.counts[seat]),
      );
      decisionMs += decision.elapsedMs;
      decisions += 1;
      state = localGameReducer(state, { type: 'discard', seat, physicalId: decision.physicalId });
    }
    actions += 1;
  }
  const winner = state?.result?.kind === 'ron' ? state.result.winner : null;
  return { winner, durationMs: performance.now() - started, decisionMs, decisions };
}

function formatMs(value: number): string {
  return `${value.toFixed(2)} ms`;
}

const parsedCount = Number(process.argv[2] ?? DEFAULT_SEEDS.length);
const matchCount = Number.isSafeInteger(parsedCount)
  ? Math.min(120, Math.max(1, parsedCount))
  : DEFAULT_SEEDS.length;
const seeds = Array.from(
  { length: matchCount },
  (_, index) =>
    DEFAULT_SEEDS[index % DEFAULT_SEEDS.length] + Math.floor(index / DEFAULT_SEEDS.length) * 1009,
);

console.log(
  `Deterministic two-AI benchmark · ${matchCount} matches per pairing · seeds: ${seeds.join(', ')}`,
);
for (const pairing of PAIRINGS) {
  const totals = { eastWins: 0, westWins: 0, draws: 0, durationMs: 0, decisionMs: 0, decisions: 0 };
  for (const seed of seeds) {
    const match = simulateMatch(seed, pairing);
    if (match.winner === 0) totals.eastWins += 1;
    else if (match.winner === 1) totals.westWins += 1;
    else totals.draws += 1;
    totals.durationMs += match.durationMs;
    totals.decisionMs += match.decisionMs;
    totals.decisions += match.decisions;
  }
  const averageDuration = totals.durationMs / matchCount;
  const averageDecision = totals.decisions ? totals.decisionMs / totals.decisions : 0;
  console.log(
    `${pairing[0]} (East) vs ${pairing[1]} (West): wins ${totals.eastWins}/${totals.westWins}, draws ${totals.draws}; avg match ${formatMs(averageDuration)}; avg decision ${formatMs(averageDecision)}`,
  );
}

console.log(`Supported levels: ${DIFFICULTIES.join(', ')}`);
