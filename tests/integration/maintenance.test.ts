import assert from 'node:assert/strict';
import test from 'node:test';
import { runRoomMaintenance } from '../../worker/maintenance';

function fakeDatabase(state: Record<string, unknown>, presence: [number | null, number | null]) {
  let savedState: Record<string, unknown> | null = null;
  const appendedEvents: { type: string; payload: unknown }[] = [];
  const db = {
    prepare(query: string) {
      let values: unknown[] = [];
      return {
        bind(...bound: unknown[]) {
          values = bound;
          return {
            async all<T>() {
              if (query.includes('FROM game_rooms r'))
                return {
                  results: [{ code: 'AB23CD', state: JSON.stringify(state) }] as T[],
                };
              if (query.includes('FROM room_presence'))
                return {
                  results: presence.flatMap((last_seen_at, seat) =>
                    last_seen_at === null ? [] : [{ seat, last_seen_at }],
                  ) as T[],
                };
              return { results: [] as T[] };
            },
            async run() {
              if (query.includes('UPDATE game_rooms')) {
                savedState = JSON.parse(String(values[0])) as Record<string, unknown>;
                return { meta: { changes: 1 } };
              }
              if (query.includes('INSERT INTO game_events'))
                appendedEvents.push({
                  type: String(values[1]),
                  payload: JSON.parse(String(values[3])) as unknown,
                });
              return { meta: { changes: query.includes('UPDATE game_rooms') ? 1 : 0 } };
            },
          };
        },
      };
    },
    async batch(statements: { run: () => Promise<{ meta: { changes: number } }> }[]) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  } as unknown as D1Database;
  return { db, getSavedState: () => savedState, getAppendedEvents: () => appendedEvents };
}

function activeRoom(now: number, deadline: number) {
  return {
    tokens: ['host-token', 'guest-token'],
    hands: [Array(13).fill(0), Array(13).fill(1)],
    turn: 1,
    pendingRon: 1,
    pendingScore: { han: 5 },
    result: null,
    version: 12,
    turnDeadlineAt: deadline,
    now,
  };
}

test('scheduled maintenance forfeits an expired turn and clears its deadline', async () => {
  const now = 1_800_000_000_000;
  const fixture = fakeDatabase(activeRoom(now, now - 1), [now, now]);
  const summary = await runRoomMaintenance(fixture.db, now);
  const saved = fixture.getSavedState();

  assert.equal(summary.settled, 1);
  assert.deepEqual(saved?.result, {
    kind: 'forfeit',
    winner: 0,
    loser: 1,
    reason: 'turn-timeout',
  });
  assert.equal(saved?.turnDeadlineAt, null);
  assert.equal(saved?.pendingRon, null);
  assert.equal(saved?.version, 13);
  assert.equal(fixture.getAppendedEvents()[0]?.type, 'player.forfeited');
});

test('scheduled maintenance awards a disconnect forfeit but draws if both seats are gone', async () => {
  const now = 1_800_000_000_000;
  const disconnectedAt = now - 90_000;
  const single = fakeDatabase(activeRoom(now, now + 60_000), [now, disconnectedAt]);
  await runRoomMaintenance(single.db, now);
  assert.deepEqual(single.getSavedState()?.result, {
    kind: 'forfeit',
    winner: 0,
    loser: 1,
    reason: 'disconnect',
  });

  const both = fakeDatabase(activeRoom(now, now + 60_000), [disconnectedAt, disconnectedAt]);
  await runRoomMaintenance(both.db, now);
  assert.deepEqual(both.getSavedState()?.result, {
    kind: 'draw',
    reason: 'both-disconnected',
  });
  assert.equal(both.getAppendedEvents()[0]?.type, 'hand.drawn');
});
