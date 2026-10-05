import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('all D1 migrations are present and ordered', async () => {
  const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')) as {
    entries: Array<{ tag: string; idx: number }>;
  };
  assert.ok(journal.entries.length >= 5);
  assert.deepEqual(
    journal.entries.map((entry) => entry.tag),
    [...journal.entries].sort((left, right) => left.idx - right.idx).map((entry) => entry.tag),
  );
  for (const entry of journal.entries) {
    await assert.doesNotReject(readFile(`drizzle/${entry.tag}.sql`, 'utf8'));
  }
});

test('match-event migration includes the append-only update guard and legacy-room checkpoint', async () => {
  const sql = await readFile('drizzle/0004_previous_impossible_man.sql', 'utf8');
  assert.match(sql, /trg_game_events_no_update/);
  assert.match(sql, /game events are immutable/);
  assert.match(sql, /match\.restored/);
});
