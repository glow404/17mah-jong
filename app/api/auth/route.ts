/**
 * 账号 API 路由。
 *
 * GET 返回当前会话用户；POST 根据 action 执行注册、登录或退出登录。
 * 具体的密码哈希、会话查询和数据库操作集中在 db/auth.ts，本文件只
 * 负责 HTTP 请求解析、状态码和 Cookie 响应头。
 */
import {
  createSession,
  deleteAccount,
  deleteAllSessions,
  deleteSession,
  ensureAuthTables,
  getSessionUser,
  registerUser,
  verifyUser,
} from '../../../db/auth';
import { enforceRateLimit, parseJsonObject, requireSameOrigin } from '../../../lib/security';

export async function GET(request: Request) {
  try {
    await ensureAuthTables();
    return Response.json(
      { user: await getSessionUser(request) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '账号读取失败' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    enforceRateLimit(request, 'auth', 10);
    await ensureAuthTables();
    const body = await parseJsonObject(request);
    const action = typeof body.action === 'string' ? body.action : '';
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (action === 'register') {
      const user = await registerUser(email, password);
      return Response.json(
        { user },
        { status: 201, headers: { 'Set-Cookie': await createSession(user, request) } },
      );
    }
    if (action === 'login') {
      const user = await verifyUser(email, password);
      if (!user) return Response.json({ error: '邮箱或密码不正确' }, { status: 401 });
      return Response.json(
        { user },
        { headers: { 'Set-Cookie': await createSession(user, request) } },
      );
    }
    if (action === 'logout') {
      return Response.json(
        { user: null },
        { headers: { 'Set-Cookie': await deleteSession(request) } },
      );
    }
    if (action === 'logout-all' || action === 'delete-account') {
      const current = await getSessionUser(request);
      if (!current) return Response.json({ error: '请先登录' }, { status: 401 });
      if (action === 'delete-account') {
        if (!(await verifyUser(current.email, password)))
          return Response.json({ error: '密码不正确' }, { status: 401 });
        await deleteAccount(current.id);
      } else await deleteAllSessions(current.id);
      return Response.json(
        { user: null },
        { headers: { 'Set-Cookie': await deleteSession(request) } },
      );
    }
    return Response.json({ error: '未知的账号操作' }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '账号操作失败' },
      { status: 400 },
    );
  }
}
