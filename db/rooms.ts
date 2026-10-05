/**
 * 联机房间的轻量 D1 存储层。
 *
 * 房间状态以 JSON 保存，便于把一局牌的完整状态作为一个版本读写。
 * saveRoom 使用 JSON 中的 version 作为更新条件，避免两个玩家同时操作
 * 时后写入的请求覆盖较新的状态。
 */
import { env } from 'cloudflare:workers';
import type { MatchEvent, MatchEventInput } from '../lib/history/events';
import { saveRoomWithHistory } from './roomStore';
import type { SaveRoomOptions } from './roomStore';

export { saveRoomWithHistory } from './roomStore';
export type { SaveRoomOptions } from './roomStore';

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
  const db = database();
  const now = Date.now();
  const matchId = crypto.randomUUID().replaceAll('-', '');
  const room = state as {
    baseScore: number;
    pools: [number[], number[]];
    indicator: number;
    uraIndicator: number;
    userIds: [string, string | null];
    version: number;
  };
  const event: MatchEventInput = {
    type: 'match.created',
    seat: 0,
    stateVersion: room.version,
    createdAt: now,
    payload: {
      baseScore: room.baseScore,
      pools: [room.pools[0].slice(), room.pools[1].slice()],
      indicator: room.indicator,
      uraIndicator: room.uraIndicator,
    },
  };
  await db.batch([
    db
      .prepare('INSERT INTO game_rooms (code, state, updated_at) VALUES (?, ?, ?)')
      .bind(code, JSON.stringify(state), now),
    db
      .prepare(
        'INSERT INTO game_history (match_id, room_code, player0_id, base_score, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(matchId, code, room.userIds[0], room.baseScore, now),
    db
      .prepare(
        `INSERT INTO game_events (match_id, sequence, state_version, type, seat, payload, created_at)
         VALUES (?, 1, ?, ?, ?, ?, ?)`,
      )
      .bind(
        matchId,
        event.stateVersion,
        event.type,
        event.seat,
        JSON.stringify(event.payload),
        event.createdAt,
      ),
  ]);
}

export async function saveRoom(
  code: string,
  state: unknown,
  expectedVersion: number,
  options: SaveRoomOptions,
) {
  return saveRoomWithHistory(database(), code, state, expectedVersion, options);
}

export interface MatchHistoryRow {
  matchId: string;
  startedAt: number;
  finishedAt: number;
  baseScore: number;
  viewerSeat: 0 | 1;
  result: string;
}

export async function listMatchHistory(userId: string, limit = 50): Promise<MatchHistoryRow[]> {
  const rows = await database()
    .prepare(
      `SELECT match_id, created_at, finished_at, base_score,
         CASE WHEN player0_id = ? THEN 0 ELSE 1 END AS viewer_seat, result
       FROM game_history
       WHERE finished_at IS NOT NULL AND (player0_id = ? OR player1_id = ?)
       ORDER BY finished_at DESC, match_id DESC
       LIMIT ?`,
    )
    .bind(userId, userId, userId, Math.max(1, Math.min(100, limit)))
    .all<{
      match_id: string;
      created_at: number;
      finished_at: number;
      base_score: number;
      viewer_seat: number;
      result: string;
    }>();
  return (rows.results ?? []).flatMap((row) =>
    row.viewer_seat === 0 || row.viewer_seat === 1
      ? [
          {
            matchId: row.match_id,
            startedAt: row.created_at,
            finishedAt: row.finished_at,
            baseScore: row.base_score,
            viewerSeat: row.viewer_seat,
            result: row.result,
          },
        ]
      : [],
  );
}

export async function readMatchHistory(matchId: string, userId: string) {
  const row = await database()
    .prepare(
      `SELECT match_id, created_at, finished_at, base_score,
         CASE WHEN player0_id = ? THEN 0 ELSE 1 END AS viewer_seat, result
       FROM game_history
       WHERE match_id = ? AND finished_at IS NOT NULL AND (player0_id = ? OR player1_id = ?)
       LIMIT 1`,
    )
    .bind(userId, matchId, userId, userId)
    .first<{
      match_id: string;
      created_at: number;
      finished_at: number;
      base_score: number;
      viewer_seat: number;
      result: string;
    }>();
  if (!row || (row.viewer_seat !== 0 && row.viewer_seat !== 1)) return null;
  return {
    matchId: row.match_id,
    startedAt: row.created_at,
    finishedAt: row.finished_at,
    baseScore: row.base_score,
    viewerSeat: row.viewer_seat,
    result: row.result,
  } satisfies MatchHistoryRow;
}

export async function readMatchEvents(matchId: string): Promise<MatchEvent[]> {
  const rows = await database()
    .prepare(
      `SELECT sequence, state_version, type, seat, payload, created_at
       FROM game_events WHERE match_id = ? ORDER BY sequence ASC`,
    )
    .bind(matchId)
    .all<{
      sequence: number;
      state_version: number;
      type: MatchEvent['type'];
      seat: MatchEvent['seat'];
      payload: string;
      created_at: number;
    }>();
  return (rows.results ?? []).map((row) => ({
    sequence: row.sequence,
    stateVersion: row.state_version,
    type: row.type,
    seat: row.seat,
    payload: JSON.parse(row.payload),
    createdAt: row.created_at,
  })) as MatchEvent[];
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
