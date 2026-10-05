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

export async function saveRoom(code: string, state: unknown, expectedVersion: number) {
  const result = await database()
    .prepare(
      "UPDATE game_rooms SET state = ?, updated_at = ? WHERE code = ? AND json_extract(state, '$.version') = ?",
    )
    .bind(JSON.stringify(state), Date.now(), code, expectedVersion)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
