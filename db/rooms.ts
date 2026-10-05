/**
 * 联机房间的轻量 D1 存储层。
 *
 * 房间状态以 JSON 保存，便于把一局牌的完整状态作为一个版本读写。
 * saveRoom 使用 JSON 中的 version 作为更新条件，避免两个玩家同时操作
 * 时后写入的请求覆盖较新的状态。
 */
import { env } from 'cloudflare:workers';

function database() {
  if (!env.DB) throw new Error('联机房间数据库尚未连接');
  return env.DB;
}

export async function ensureRoomsTable() {
  await database()
    .prepare(
      `CREATE TABLE IF NOT EXISTS game_rooms (
    code TEXT PRIMARY KEY NOT NULL,
    state TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
    )
    .run();
}

export async function readRoom<T>(code: string): Promise<T | null> {
  const row = await database()
    .prepare('SELECT state FROM game_rooms WHERE code = ? LIMIT 1')
    .bind(code)
    .first<{ state: string }>();
  return row ? (JSON.parse(row.state) as T) : null;
}

export async function createRoomRecord(code: string, state: unknown) {
  await database()
    .prepare('INSERT INTO game_rooms (code, state, updated_at) VALUES (?, ?, ?)')
    .bind(code, JSON.stringify(state), Date.now())
    .run();
}

export async function saveRoom(
  code: string,
  state: unknown,
  expectedVersion: number,
  expectedPresence?: readonly { seat: 0 | 1; lastSeenAt: number | null }[],
) {
  const presenceGuard = (expectedPresence ?? [])
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
  for (const presence of expectedPresence ?? [])
    values.push(code, presence.seat, presence.lastSeenAt);
  const result = await database()
    .prepare(
      `UPDATE game_rooms SET state = ?, updated_at = ? WHERE code = ? AND json_extract(state, '$.version') = ?${presenceGuard}`,
    )
    .bind(...values)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Upsert one player's presence heartbeat without changing the game version. */
export async function touchRoomPresence(
  code: string,
  seat: 0 | 1,
  now = Date.now(),
  minimumIntervalMs = 0,
) {
  const db = database();
  const result = await db
    .prepare(
      `INSERT INTO room_presence (room_code, seat, last_seen_at) VALUES (?, ?, ?)
       ON CONFLICT(room_code, seat) DO UPDATE SET last_seen_at = excluded.last_seen_at
       WHERE room_presence.last_seen_at <= excluded.last_seen_at - ?`,
    )
    .bind(code, seat, now, minimumIntervalMs)
    .run();
  if ((result.meta.changes ?? 0) > 0)
    await db.prepare('UPDATE game_rooms SET updated_at = ? WHERE code = ?').bind(now, code).run();
}

/** Read the latest heartbeat timestamp for each seat, using null for unseen seats. */
export async function readRoomPresence(code: string): Promise<[number | null, number | null]> {
  const rows = await database()
    .prepare('SELECT seat, last_seen_at FROM room_presence WHERE room_code = ?')
    .bind(code)
    .all<{ seat: number; last_seen_at: number }>();
  const presence: [number | null, number | null] = [null, null];
  for (const row of rows.results ?? []) {
    if (row.seat === 0 || row.seat === 1) presence[row.seat] = row.last_seen_at;
  }
  return presence;
}

/** Return room records for the low-frequency server-side deadline sweep. */
export async function listRoomsForMaintenance(): Promise<
  { code: string; state: string; updatedAt: number }[]
> {
  const result = await database()
    .prepare('SELECT code, state, updated_at FROM game_rooms')
    .all<{ code: string; state: string; updated_at: number }>();
  return (result.results ?? []).map(({ code, state, updated_at }) => ({
    code,
    state,
    updatedAt: updated_at,
  }));
}

/** Delete expired rooms and their presence rows in a single D1 batch. */
export async function deleteExpiredRooms(cutoff: number): Promise<number> {
  const db = database();
  const result = await db.batch([
    db
      .prepare(
        'DELETE FROM room_presence WHERE room_code IN (SELECT code FROM game_rooms WHERE updated_at < ?)',
      )
      .bind(cutoff),
    db.prepare('DELETE FROM game_rooms WHERE updated_at < ?').bind(cutoff),
  ]);
  return result[1]?.meta.changes ?? 0;
}
