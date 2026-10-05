import assert from 'node:assert/strict';
import test from 'node:test';
import type { MatchEvent, MatchEventInput, MatchHistorySummary } from '../lib/history/events';
import { createMatchReplayExport } from '../lib/history/export';
import { readLocalMatchHistory, saveLocalMatchHistory } from '../lib/history/local';
import { ReplayError, replayMatchEvents } from '../lib/history/replay';

const now = 1_800_000_000_000;

function makeRonEvents(): MatchEvent[] {
  const targetTypes = [0, 1, 2, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8];
  const usedCopies = new Map<number, number>();
  const winningHandIds = targetTypes.map((type) => {
    const copy = usedCopies.get(type) ?? 0;
    usedCopies.set(type, copy + 1);
    return type * 4 + copy;
  });
  const reserved = new Set(winningHandIds);
  const westPool = winningHandIds.slice();
  for (const id of [34, ...Array.from({ length: 136 }, (_, index) => index)]) {
    if (westPool.length === 34) break;
    if (!reserved.has(id) && !westPool.includes(id)) westPool.push(id);
  }
  const remaining = Array.from({ length: 136 }, (_, index) => index).filter(
    (id) => !westPool.includes(id),
  );
  const eastPool = [35, ...remaining.filter((id) => id !== 35).slice(0, 33)];
  const eastHand = eastPool.slice(1, 14);
  return [
    {
      sequence: 1,
      type: 'match.created',
      seat: 0,
      stateVersion: 1,
      createdAt: now,
      payload: { baseScore: 5000, pools: [eastPool, westPool], indicator: 7, uraIndicator: 8 },
    },
    {
      sequence: 2,
      type: 'player.joined',
      seat: 1,
      stateVersion: 2,
      createdAt: now + 1,
      payload: {},
    },
    {
      sequence: 3,
      type: 'hand.selected',
      seat: 0,
      stateVersion: 3,
      createdAt: now + 2,
      payload: { selectedIds: eastHand, turnDeadlineAt: null },
    },
    {
      sequence: 4,
      type: 'hand.selected',
      seat: 1,
      stateVersion: 4,
      createdAt: now + 3,
      payload: { selectedIds: winningHandIds, turnDeadlineAt: now + 60_000 },
    },
    {
      sequence: 5,
      type: 'tile.discarded',
      seat: 0,
      stateVersion: 5,
      createdAt: now + 4,
      payload: { physicalTileId: 35, turnDeadlineAt: now + 60_000 },
    },
    {
      sequence: 6,
      type: 'ron.claimed',
      seat: 1,
      stateVersion: 6,
      createdAt: now + 5,
      payload: {},
    },
  ] as MatchEvent[];
}

function makeDrawEvents(): MatchEvent[] {
  const pool0 = Array.from({ length: 34 }, (_, index) => index);
  const pool1 = Array.from({ length: 34 }, (_, index) => index + 34);
  const selected0 = pool0.slice(0, 13);
  const selected1 = pool1.slice(0, 13);
  const events: MatchEventInput[] = [
    {
      type: 'match.created',
      seat: 0,
      stateVersion: 1,
      createdAt: now,
      payload: { baseScore: 1000, pools: [pool0, pool1], indicator: 27, uraIndicator: 28 },
    },
    { type: 'player.joined', seat: 1, stateVersion: 2, createdAt: now + 1, payload: {} },
    {
      type: 'hand.selected',
      seat: 0,
      stateVersion: 3,
      createdAt: now + 2,
      payload: { selectedIds: selected0, turnDeadlineAt: null },
    },
    {
      type: 'hand.selected',
      seat: 1,
      stateVersion: 4,
      createdAt: now + 3,
      payload: { selectedIds: selected1, turnDeadlineAt: now + 60_000 },
    },
    {
      type: 'hand.drawn',
      seat: null,
      stateVersion: 5,
      createdAt: now + 4,
      payload: { reason: 'both-disconnected' },
    },
  ];
  return events.map((event, index) => ({ ...event, sequence: index + 1 })) as MatchEvent[];
}

test('event replay reconstructs the winning hand, dora score, and every seekable frame', () => {
  const events = makeRonEvents();
  const frames = replayMatchEvents(events);

  assert.equal(frames.length, events.length);
  assert.equal(frames[3]?.turn, 0);
  assert.equal(frames[4]?.pendingRon, 1);
  assert.equal(frames[4]?.pendingScore?.tier, '役满');
  assert.equal(frames[5]?.result?.kind, 'ron');
  assert.equal(frames[5]?.result?.kind === 'ron' ? frames[5].result.payment : 0, 20_000);
  assert.equal(frames[4]?.result, null, 'earlier replay frames remain immutable');
});

test('event replay reconstructs a draw and rejects missing, reordered, or invalid events', () => {
  const events = makeDrawEvents();
  const frames = replayMatchEvents(events);
  assert.deepEqual(frames.at(-1)?.result, { kind: 'draw', reason: 'both-disconnected' });
  assert.throws(() => replayMatchEvents(events.slice(1)), ReplayError);
  assert.throws(
    () => replayMatchEvents(events.map((event, index) => ({ ...event, sequence: index + 2 }))),
    ReplayError,
  );
  assert.throws(
    () =>
      replayMatchEvents([
        ...events.slice(0, 1),
        { ...events[1]!, stateVersion: 9 },
        ...events.slice(2),
      ]),
    ReplayError,
  );
  const prematureDraw = events.map((event) => ({ ...event }));
  const last = prematureDraw.at(-1)!;
  if (last.type === 'hand.drawn') last.payload = { reason: 'seventeen-discard' };
  assert.throws(() => replayMatchEvents(prematureDraw), ReplayError);
});

test('replay restores a validated legacy checkpoint and records pass-furiten and forfeits', () => {
  const ronEvents = makeRonEvents();
  const pendingFrames = replayMatchEvents([
    ...ronEvents.slice(0, 5),
    {
      sequence: 6,
      type: 'ron.declined',
      seat: 1,
      stateVersion: 6,
      createdAt: now + 5,
      payload: { turnDeadlineAt: now + 60_000 },
    },
    {
      sequence: 7,
      type: 'player.forfeited',
      seat: 1,
      stateVersion: 7,
      createdAt: now + 6,
      payload: { winner: 0, reason: 'resigned' },
    },
  ]);
  assert.equal(pendingFrames[5]?.temporaryFuriten[1], true);
  assert.equal(pendingFrames[5]?.pendingRon, null);
  assert.deepEqual(pendingFrames.at(-1)?.result, {
    kind: 'forfeit',
    winner: 0,
    loser: 1,
    reason: 'resigned',
  });

  const drawEvents = makeDrawEvents();
  const state = replayMatchEvents(drawEvents)[3]!;
  state.version = 10;
  const restored = replayMatchEvents([
    {
      sequence: 1,
      type: 'match.restored',
      seat: null,
      stateVersion: 10,
      createdAt: now + 10,
      payload: { state },
    },
    {
      sequence: 2,
      type: 'player.forfeited',
      seat: 0,
      stateVersion: 11,
      createdAt: now + 11,
      payload: { winner: 1, reason: 'turn-timeout' },
    },
  ]);
  assert.deepEqual(restored.at(-1)?.result, {
    kind: 'forfeit',
    winner: 1,
    loser: 0,
    reason: 'turn-timeout',
  });
});

test('portable JSON export strips room, account, and credential fields from archive and events', () => {
  const match: MatchHistorySummary & { roomCode: string; playerId: string } = {
    matchId: '0123456789abcdef0123456789abcdef',
    startedAt: now,
    finishedAt: now + 10,
    baseScore: 5000,
    viewerSeat: 1,
    result: { kind: 'draw' },
    roomCode: 'AB23CD',
    playerId: 'private-user-id',
  };
  const events = makeDrawEvents();
  const unsafeEvent = {
    ...events[0]!,
    roomCode: 'AB23CD',
    token: 'room-secret-token',
    payload: {
      ...events[0]!.payload,
      email: 'player@example.com',
      userId: 'private-user-id',
    },
  } as unknown as MatchEvent;
  const exported = createMatchReplayExport(match, [unsafeEvent, ...events.slice(1)]);
  const json = JSON.stringify(exported);

  assert.equal(exported.format, '17mah-jong-replay');
  assert.ok(!json.includes('AB23CD'));
  assert.ok(!json.includes('room-secret-token'));
  assert.ok(!json.includes('player@example.com'));
  assert.ok(!json.includes('private-user-id'));
});

test('local history validates, deduplicates, and bounds browser-only replays', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  const result = { kind: 'draw' } as const;
  const makeReplay = (index: number) =>
    createMatchReplayExport(
      {
        matchId: index.toString(16).padStart(32, '0'),
        startedAt: now + index,
        finishedAt: now + index + 1,
        baseScore: 1000,
        viewerSeat: 0,
        result,
      },
      makeDrawEvents(),
    );

  for (let index = 0; index < 55; index += 1) saveLocalMatchHistory(makeReplay(index), storage);
  const history = readLocalMatchHistory(storage);
  assert.equal(history.length, 50);
  assert.equal(history[0]?.match.matchId, makeReplay(54).match.matchId);
  saveLocalMatchHistory(makeReplay(54), storage);
  assert.equal(
    readLocalMatchHistory(storage).length,
    50,
    'saving the same match replaces rather than duplicates it',
  );

  values.set('17mah-jong:match-history:v1', '{not json');
  assert.deepEqual(readLocalMatchHistory(storage), []);
});
