/**
 * 账号 API 路由。
 *
 * GET 返回当前会话用户；POST 根据 action 执行注册、登录或退出登录。
 * 具体的密码哈希、会话查询和数据库操作集中在 db/auth.ts，本文件只
 * 负责 HTTP 请求解析、状态码和 Cookie 响应头。
 */
import { createSession, deleteSession, ensureAuthTables, getSessionUser, registerUser, verifyUser } from "../../../db/auth";

export async function GET(request: Request) {
  try {
    await ensureAuthTables();
    return Response.json({ user: await getSessionUser(request) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "账号读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureAuthTables();
    const body = await request.json() as { action?: string; email?: string; password?: string };
    if (body.action === "register") {
      const user = await registerUser(body.email ?? "", body.password ?? "");
      return Response.json({ user }, { status: 201, headers: { "Set-Cookie": await createSession(user, request) } });
    }
    if (body.action === "login") {
      const user = await verifyUser(body.email ?? "", body.password ?? "");
      if (!user) return Response.json({ error: "邮箱或密码不正确" }, { status: 401 });
      return Response.json({ user }, { headers: { "Set-Cookie": await createSession(user, request) } });
    }
    if (body.action === "logout") {
      return Response.json({ user: null }, { headers: { "Set-Cookie": await deleteSession(request) } });
    }
    return Response.json({ error: "未知的账号操作" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "账号操作失败" }, { status: 400 });
  }
}
