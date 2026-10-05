# Computer AI

The local opponent is exposed through the `MahjongAi` interface in `app/game/ai.ts`. The module receives the legal reserve, public rivers, seat wind, a random source, and a decision-time budget. It does not read React state, the player's concealed hand, the database, or the network.

## Strategy levels

- **Easy** chooses a legal reserve tile uniformly using the injected PRNG.
- **Normal** builds its opening tenpai hand from its 34-tile pool. The selector ranks valid mangan-or-better waits by score, wait count, and estimated ukeire. During play it favors lower intrinsic tile danger (terminals and honors over middle tiles), while avoiding an own-wait discard that would cause permanent furiten.
- **Hard** applies a public-information risk estimate to each reserve candidate. It discounts repeated river tiles and suji-like signals, accounts for remaining visible copies, estimates the chance that the opponent has become furiten from the size of their river, and protects its own waits from accidental permanent furiten. It also checks the AI's own furiten state exactly. Its explanations report these signals and the estimated risk.

This game's hand is fixed at the start and players do not draw. Consequently, shanten and ukeire can meaningfully guide **opening hand construction**, but cannot change when one of the 21 reserve tiles is discarded. The actual discard policy therefore ranks available reserve tiles by deal-in risk instead of pretending that discarding a reserve changes the hand's shanten. Easy, normal, and hard all use a valid opening hand so every level can participate in a scored game.

Hard-mode risk is a transparent heuristic, not an exact probability or a claim of equivalence with Mahjong Soul. Discards are public, while the opponent's hand remains hidden. In particular, the estimated furiten rate assumes a simplified distribution over waits. The AI never reads the opponent's concealed hand to improve local play.

## Reproducibility and time budget

The match setup records a cryptographically generated seed. Each AI turn derives an independent seeded PRNG stream from that seed and the seat's discard count. The same state, difficulty, and seed therefore produce the same action; measured latency itself naturally varies by device.

Each discard decision has a 20 ms soft budget. The candidate scan checks the deadline between candidates and returns a seeded legal-random fallback if the budget is reached. There are at most 21 reserve candidates and the current estimator is deliberately bounded, so it runs synchronously without blocking a Worker. Opening-hand construction is a separate bounded selector (up to 5,200 candidates) and is not part of the per-turn decision budget.

## Metrics and regression checks

Completed local games aggregate CPU win rate, average match duration, and average decision latency per difficulty in browser `localStorage`; no account or server telemetry is involved. Clearing site data removes these metrics.

`tests/fixtures/ai-benchmarks.ts` holds fixed public-information decision scenarios. `tests/ai.test.ts` checks legal actions, seeded repeatability, shanten/ukeire, risk signals, budget fallback, and aggregate statistics. Run the fixed-seed AI-vs-AI game benchmark with:

```sh
npm run benchmark:ai
npm run benchmark:ai -- 60
```

The benchmark reports pairwise outcomes, total match time, and average decision latency. Run it on a stable machine and compare multiple runs before drawing conclusions from small samples.
