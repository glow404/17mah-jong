import { env } from 'cloudflare:workers';
import { logEvent } from '../../../worker/observability';

/** Readiness probe: return 200 only after the Worker can execute a D1 query. */
export async function GET(request: Request) {
  const requestId = request.headers.get('X-Request-ID') ?? 'unassigned';
  const headers = { 'Cache-Control': 'no-store' };

  try {
    await env.DB.prepare('SELECT 1 AS healthy').first<{ healthy: number }>();
    return Response.json({ status: 'ok' }, { headers });
  } catch (error) {
    logEvent('health.database_unavailable', 'error', {
      requestId,
      dependency: 'd1',
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return Response.json(
      { status: 'unavailable', dependency: 'database', requestId },
      { status: 503, headers },
    );
  }
}
