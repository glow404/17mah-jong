import { ensureAuthTables, getSessionUser } from '../../../db/auth';
import { listMatchHistory, readMatchEvents, readMatchHistory } from '../../../db/rooms';
import type { GameResult } from '../../../lib/contracts/mahjong';
import { createMatchReplayExport } from '../../../lib/history/export';
import type { MatchHistorySummary } from '../../../lib/history/events';
import { replayMatchEvents } from '../../../lib/history/replay';

export async function GET(request: Request) {
  try {
    await ensureAuthTables();
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: '请先登录后查看对局历史' }, { status: 401 });

    const url = new URL(request.url);
    const matchId = url.searchParams.get('matchId');
    if (!matchId) {
      const requestedLimit = Number(url.searchParams.get('limit') ?? 50);
      const limit = Number.isSafeInteger(requestedLimit) ? requestedLimit : 50;
      const rows = await listMatchHistory(user.id, limit);
      return Response.json(
        {
          matches: rows.map((row) => ({
            matchId: row.matchId,
            startedAt: row.startedAt,
            finishedAt: row.finishedAt,
            baseScore: row.baseScore,
            viewerSeat: row.viewerSeat,
            result: JSON.parse(row.result) as GameResult,
          })),
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    if (!/^[a-f\d]{32}$/i.test(matchId))
      return Response.json({ error: '牌局编号无效' }, { status: 400 });
    const row = await readMatchHistory(matchId, user.id);
    if (!row) return Response.json({ error: '牌局不存在或无权查看' }, { status: 404 });
    const result = JSON.parse(row.result) as GameResult;
    const match: MatchHistorySummary = { ...row, result };
    const events = await readMatchEvents(matchId);
    const frames = replayMatchEvents(events);
    if (JSON.stringify(frames.at(-1)?.result) !== JSON.stringify(result))
      throw new Error('结算摘要与事件回放结果不一致');
    const document = createMatchReplayExport(match, events);
    const headers = new Headers({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (url.searchParams.get('format') === 'export')
      headers.set('Content-Disposition', `attachment; filename="17mah-jong-${matchId}.json"`);
    return Response.json(document, { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '对局历史读取失败' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
