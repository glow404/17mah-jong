/**
 * 账号和会话存储层。
 *
 * 密码不会明文落库，而是使用随机盐和 PBKDF2-SHA-256 派生哈希；浏览器
 * 只持有 HttpOnly 会话 Cookie，数据库保存会话令牌的 SHA-256 哈希。
 * 本文件还负责初始化认证表、校验邮箱/密码以及注销会话。
 */
import { env } from 'cloudflare:workers';

export interface AuthUser {
  id: string;
  email: string;
}

const SESSION_COOKIE = 'mahjong_session';
const SESSION_SECONDS = 60 * 60 * 24 * 7;

function database() {
  if (!env.DB) throw new Error('账号数据库尚未连接');
  return env.DB;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

async function derivePassword(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt.buffer as ArrayBuffer, iterations: 120_000 },
    key,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1)
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function readCookie(request: Request, name: string) {
  const cookies = request.headers.get('cookie') ?? '';
  for (const part of cookies.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

export async function ensureAuthTables() {
  const db = database();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)'),
    db.prepare('PRAGMA optimize'),
  ]);
  await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(Date.now()).run();
}

export async function deleteAllSessions(userId: string) {
  await database().prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

export async function deleteAccount(userId: string) {
  await database().prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
}

export async function registerUser(emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new Error('请输入有效的邮箱地址');
  if (password.length < 8 || password.length > 128) throw new Error('密码需要 8–128 个字符');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await derivePassword(password, salt);
  const user: AuthUser = { id: crypto.randomUUID(), email };
  try {
    await database()
      .prepare(
        'INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(user.id, user.email, passwordHash, bytesToBase64(salt), Date.now())
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes('unique'))
      throw new Error('这个邮箱已经注册');
    throw error;
  }
  return user;
}

export async function verifyUser(emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();
  const row = await database()
    .prepare('SELECT id, email, password_hash, password_salt FROM users WHERE email = ? LIMIT 1')
    .bind(email)
    .first<{ id: string; email: string; password_hash: string; password_salt: string }>();
  if (!row) return null;
  const candidate = await derivePassword(password, base64ToBytes(row.password_salt));
  return constantTimeEqual(candidate, row.password_hash)
    ? ({ id: row.id, email: row.email } satisfies AuthUser)
    : null;
}

export async function createSession(user: AuthUser, request: Request) {
  const rawToken = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  const tokenHash = await sha256(rawToken);
  const now = Date.now();
  await database()
    .prepare(
      'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    )
    .bind(tokenHash, user.id, now + SESSION_SECONDS * 1000, now)
    .run();
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`;
}

export async function getSessionUser(request: Request): Promise<AuthUser | null> {
  const rawToken = readCookie(request, SESSION_COOKIE);
  if (!rawToken) return null;
  const tokenHash = await sha256(rawToken);
  const row = await database()
    .prepare(
      `SELECT users.id, users.email
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ? LIMIT 1`,
    )
    .bind(tokenHash, Date.now())
    .first<AuthUser>();
  return row ?? null;
}

export async function deleteSession(request: Request) {
  const rawToken = readCookie(request, SESSION_COOKIE);
  if (rawToken)
    await database()
      .prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await sha256(rawToken))
      .run();
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
