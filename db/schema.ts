/**
 * D1/SQLite 的 Drizzle schema。
 *
 * game_rooms 保存序列化后的联机牌局；users 保存账号和密码派生值；
 * sessions 保存短期会话的哈希。字段名使用数据库命名，导出名使用
 * TypeScript 命名，供 Drizzle 查询和迁移生成器共同使用。
 */
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const gameRooms = sqliteTable("game_rooms", {
  code: text("code").primaryKey(),
  state: text("state").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("idx_sessions_expires_at").on(table.expiresAt)]);
