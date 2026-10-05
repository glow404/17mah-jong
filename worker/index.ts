/**
 * Cloudflare Worker 入口。
 *
 * 普通请求交给 Vinext App Router；/_vinext/image 请求则使用 Cloudflare
 * Images 做尺寸和格式转换。ASSETS、DB、IMAGES 的具体值由 wrangler 配置
 * 和部署环境注入，Worker 本身只负责路由和绑定转发。
 */
import {
  handleImageOptimization,
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
} from 'vinext/server/image-optimization';
import handler from 'vinext/server/app-router-entry';
import { runRoomMaintenance } from './maintenance';
import {
  createRequestId,
  logEvent,
  observeRequest,
  observeRoomSnapshot,
  type AnalyticsSink,
} from './observability';

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  ANALYTICS?: AnalyticsSink;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledController {
  scheduledTime: number;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const requestId = createRequestId();
    const startedAt = performance.now();
    const headers = new Headers(request.headers);
    headers.set('X-Request-ID', requestId);
    const tracedRequest = new Request(request, { headers });

    let response: Response;
    try {
      if (url.pathname === '/_vinext/image') {
        const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
        response = await handleImageOptimization(
          tracedRequest,
          {
            fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
            transformImage: async (body, { width, format, quality }) => {
              const result = await env.IMAGES.input(body)
                .transform(width > 0 ? { width } : {})
                .output({ format, quality });
              return result.response();
            },
          },
          allowedWidths,
        );
      } else {
        response = await handler.fetch(tracedRequest, env, ctx);
      }
    } catch (error) {
      logEvent('worker.invocation_failed', 'error', {
        requestId,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      response = url.pathname.startsWith('/api/')
        ? Response.json({ error: '服务器内部错误', requestId }, { status: 500 })
        : new Response('Internal Server Error', { status: 500 });
    }

    observeRequest(env.ANALYTICS, {
      requestId,
      method: request.method,
      pathname: url.pathname,
      status: response.status,
      durationMs: performance.now() - startedAt,
    });
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('X-Request-ID', requestId);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },

  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const requestId = createRequestId();
    ctx.waitUntil(
      (async () => {
        try {
          const maintenance = await runRoomMaintenance(env.DB, controller.scheduledTime);
          const [activeRooms, completedMatches] = await Promise.all([
            env.DB.prepare(
              `SELECT COUNT(*) AS count FROM game_rooms
                 WHERE json_extract(state, '$.result') IS NULL`,
            ).first<{ count: number }>(),
            env.DB.prepare(
              'SELECT COUNT(*) AS count FROM game_history WHERE finished_at IS NOT NULL',
            ).first<{ count: number }>(),
          ]);
          const snapshot = {
            activeRooms: activeRooms?.count ?? 0,
            completedMatches: completedMatches?.count ?? 0,
          };
          observeRoomSnapshot(env.ANALYTICS, snapshot);
          logEvent('maintenance.completed', 'info', {
            requestId,
            ...maintenance,
            ...snapshot,
          });
        } catch (error) {
          logEvent('maintenance.failed', 'error', {
            requestId,
            errorType: error instanceof Error ? error.name : 'UnknownError',
          });
        }
      })(),
    );
  },
};

export default worker;
