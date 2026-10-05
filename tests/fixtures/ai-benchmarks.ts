/** Fixed public-information scenarios used as a small AI strategy regression suite. */
export const AI_BENCHMARKS = [
  {
    id: 'public-genbutsu-signal',
    reserveIds: [0, 16], // 1m and 5m
    opponentDiscards: [0],
    expectedHardTile: 0,
  },
  {
    id: 'suji-signal',
    reserveIds: [16, 20], // 5m and 6m
    opponentDiscards: [1], // 2m provides a 5m suji signal
    expectedHardTile: 16,
  },
  {
    id: 'ordinary-efficiency',
    reserveIds: [0, 16],
    opponentDiscards: [],
    expectedNormalTile: 0,
  },
] as const;
