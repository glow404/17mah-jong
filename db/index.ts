/**
 * Drizzle D1 客户端工厂。
 *
 * 数据库绑定由 Cloudflare Worker 注入，调用方不应在模块加载时缓存连接，
 * 而应通过 getDb() 获取带有当前 schema 的 Drizzle 客户端。
 */
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export function getDb() {
  if (!env.DB) {
    throw new Error(
      'Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database.',
    );
  }

  return drizzle(env.DB, { schema });
}
