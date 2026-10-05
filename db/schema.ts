/**
 * D1/SQLite 的 Drizzle schema。
 *
 * game_rooms 保存序列化后的联机牌局；users 保存账号和密码派生值；
 * sessions 保存短期会话的哈希。字段名使用数据库命名，导出名使用
 * TypeScript 命名，供 Drizzle 查询和迁移生成器共同使用。
 */
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const gameRooms = sqliteTable(
  'game_rooms',
  {
    code: text('code').primaryKey(),
    state: text('state').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('idx_game_rooms_updated_at').on(table.updatedAt)],
);

export const roomPresence = sqliteTable(
  'room_presence',
  {
    roomCode: text('room_code')
      .notNull()
      .references(() => gameRooms.code, { onDelete: 'cascade' }),
    seat: integer('seat').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roomCode, table.seat] }),
    index('idx_room_presence_last_seen').on(table.lastSeenAt),
  ],
);

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  passwordSalt: text('password_salt').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const sessions = sqliteTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('idx_sessions_expires_at').on(table.expiresAt)],
);

/** Persistent match metadata survives room cleanup; ended records are history entries. */
export const gameHistory = sqliteTable(
  'game_history',
  {
    matchId: text('match_id').primaryKey(),
    roomCode: text('room_code').notNull().unique(),
    player0Id: text('player0_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    player1Id: text('player1_id').references(() => users.id, { onDelete: 'cascade' }),
    baseScore: integer('base_score').notNull(),
    createdAt: integer('created_at').notNull(),
    finishedAt: integer('finished_at'),
    result: text('result'),
    finalVersion: integer('final_version'),
  },
  (table) => [
    index('idx_game_history_player0').on(table.player0Id, table.finishedAt),
    index('idx_game_history_player1').on(table.player1Id, table.finishedAt),
    index('idx_game_history_finished_at').on(table.finishedAt),
  ],
);

/** Append-only event stream. The FK intentionally targets history, not expiring rooms. */
export const gameEvents = sqliteTable(
  'game_events',
  {
    matchId: text('match_id')
      .notNull()
      .references(() => gameHistory.matchId, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    stateVersion: integer('state_version').notNull(),
    type: text('type').notNull(),
    seat: integer('seat'),
    payload: text('payload').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.matchId, table.sequence] })],
);
