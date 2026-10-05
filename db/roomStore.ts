import type { MatchEventInput } from '../lib/history/events';

export interface SaveRoomOptions {
  events: readonly MatchEventInput[];
  expectedPresence?: readonly { seat: 0 | 1; lastSeenAt: number | null }[];
  joinedUserId?: string;
}

/**
 * Atomically compare-and-sets a room, appends its immutable event(s), and updates the archive.
 * D1 executes the batch transactionally, so a stale state version cannot leave orphan events.
 */
export async function saveRoomWithHistory(
  db: D1Database,
  code: string,
  state: unknown,
  expectedVersion: number,
  options: SaveRoomOptions,
) {
  if (!options.events.length) throw new Error('每次房间版本更新都必须追加事件');
  const presenceGuard = (options.expectedPresence ?? [])
    .map(
      () => ' AND (SELECT last_seen_at FROM room_presence WHERE room_code = ? AND seat = ?) IS ?',
    )
    .join('');
  const values: (string | number | null)[] = [
    JSON.stringify(state),
    Date.now(),
    code,
    expectedVersion,
  ];
  for (const presence of options.expectedPresence ?? [])
    values.push(code, presence.seat, presence.lastSeenAt);
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE game_rooms SET state = ?, updated_at = ? WHERE code = ? AND json_extract(state, '$.version') = ?${presenceGuard}`,
      )
      .bind(...values),
  ];
  for (const event of options.events) {
    statements.push(
      db
        .prepare(
          `INSERT INTO game_events (match_id, sequence, state_version, type, seat, payload, created_at)
           SELECT h.match_id,
             COALESCE((SELECT MAX(e.sequence) + 1 FROM game_events e WHERE e.match_id = h.match_id), 1),
             ?, ?, ?, ?, ?
           FROM game_history h
           WHERE h.room_code = ? AND changes() > 0`,
        )
        .bind(
          event.stateVersion,
          event.type,
          event.seat,
          JSON.stringify(event.payload),
          event.createdAt,
          code,
        ),
    );
  }
  const room = state as { version?: number; result?: unknown };
  const finishedAt = room.result ? (options.events.at(-1)?.createdAt ?? Date.now()) : null;
  statements.push(
    db
      .prepare(
        `UPDATE game_history
         SET player1_id = COALESCE(?, player1_id),
             finished_at = COALESCE(?, finished_at),
             result = COALESCE(?, result),
             final_version = COALESCE(?, final_version)
         WHERE room_code = ? AND changes() > 0`,
      )
      .bind(
        options.joinedUserId ?? null,
        finishedAt,
        room.result ? JSON.stringify(room.result) : null,
        finishedAt === null ? null : (room.version ?? null),
        code,
      ),
  );
  const result = await db.batch(statements);
  return (result[0]?.meta.changes ?? 0) > 0;
}
