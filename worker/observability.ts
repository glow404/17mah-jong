/** Low-cardinality request logging and optional Workers Analytics Engine metrics. */
export interface AnalyticsSink {
  writeDataPoint(data: { blobs: string[]; doubles: number[]; indexes: string[] }): void;
}

export interface StructuredLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  service: '17mah-jong';
  event: string;
  requestId?: string;
  [key: string]: string | number | boolean | undefined;
}

/** Produce a cryptographically random correlation ID for each Worker invocation. */
export function createRequestId(): string {
  return crypto.randomUUID();
}

/** Map URLs to stable, non-sensitive metric labels without query strings or IDs. */
export function routeLabel(pathname: string): string {
  if (pathname === '/api/health') return 'api.health';
  if (pathname === '/api/auth') return 'api.auth';
  if (pathname === '/api/rooms') return 'api.rooms';
  if (pathname === '/api/history') return 'api.history';
  if (pathname.startsWith('/api/')) return 'api.other';
  if (pathname === '/') return 'page.home';
  if (pathname.startsWith('/_vinext/')) return 'framework';
  if (pathname.startsWith('/assets/') || pathname.includes('.')) return 'asset';
  return 'page.other';
}

/** Emit JSON logs in the same shape, without including headers, cookies, or payloads. */
export function logEvent(
  event: string,
  level: StructuredLog['level'],
  fields: Omit<Partial<StructuredLog>, 'timestamp' | 'level' | 'service' | 'event'> = {},
): void {
  const record: StructuredLog = {
    timestamp: new Date().toISOString(),
    level,
    service: '17mah-jong',
    event,
    ...fields,
  };
  const serialized = JSON.stringify(record);
  if (level === 'error') console.error(serialized);
  else if (level === 'warn') console.warn(serialized);
  else console.log(serialized);
}

/**
 * Record an HTTP observation and classify operationally useful log events.
 * Metrics deliberately omit request IDs, query strings, user IDs, and room codes.
 */
export function observeRequest(
  analytics: AnalyticsSink | undefined,
  input: {
    requestId: string;
    method: string;
    pathname: string;
    status: number;
    durationMs: number;
  },
): void {
  const route = routeLabel(input.pathname);
  const statusClass = `${Math.floor(input.status / 100)}xx`;
  const eventFields = {
    requestId: input.requestId,
    method: input.method,
    route,
    status: input.status,
    statusClass,
    durationMs: Math.round(input.durationMs * 100) / 100,
  };

  logEvent('http.request', input.status >= 500 ? 'error' : 'info', eventFields);
  if (input.status >= 500) {
    logEvent('api.server_error', 'error', {
      requestId: input.requestId,
      route,
      status: input.status,
      category: route === 'api.health' ? 'database_health_check_failed' : 'server_error',
    });
  } else if (route === 'api.rooms' && input.status === 409) {
    logEvent('room.state_conflict', 'warn', { requestId: input.requestId, status: input.status });
  } else if (route === 'api.auth' && [401, 403, 429].includes(input.status)) {
    logEvent('auth.anomaly', 'warn', { requestId: input.requestId, status: input.status });
  }

  try {
    analytics?.writeDataPoint({
      blobs: ['http.request', route, input.method, statusClass],
      doubles: [Math.max(0, input.durationMs), 1, input.status],
      indexes: ['17mah-jong'],
    });
  } catch {
    // Metrics are best-effort and must never affect an application response.
    logEvent('observability.metric_write_failed', 'warn', { requestId: input.requestId });
  }
}

/** Store a room/completion snapshot in the same dataset used by HTTP metrics. */
export function observeRoomSnapshot(
  analytics: AnalyticsSink | undefined,
  input: { activeRooms: number; completedMatches: number },
): void {
  try {
    analytics?.writeDataPoint({
      blobs: ['room.snapshot', '-', '-', '-'],
      doubles: [0, input.activeRooms, input.completedMatches],
      indexes: ['17mah-jong'],
    });
  } catch {
    logEvent('observability.metric_write_failed', 'warn', { metric: 'room.snapshot' });
  }
}
