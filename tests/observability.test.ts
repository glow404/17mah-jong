import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRequestId,
  observeRequest,
  observeRoomSnapshot,
  routeLabel,
} from '../worker/observability';

test('request IDs are UUIDs and route labels never include URL data', () => {
  assert.match(createRequestId(), /^[\da-f-]{36}$/i);
  assert.equal(routeLabel('/api/rooms'), 'api.rooms');
  assert.equal(routeLabel('/api/history'), 'api.history');
  assert.equal(routeLabel('/'), 'page.home');
});

test('room snapshots record active and completed totals without high-cardinality labels', () => {
  const points: { blobs: string[]; doubles: number[]; indexes: string[] }[] = [];
  observeRoomSnapshot(
    { writeDataPoint: (point) => points.push(point) },
    { activeRooms: 7, completedMatches: 12 },
  );
  assert.deepEqual(points, [
    {
      blobs: ['room.snapshot', '-', '-', '-'],
      doubles: [0, 7, 12],
      indexes: ['17mah-jong'],
    },
  ]);
});

test('HTTP observations emit latency/status metrics without request or query data', () => {
  const points: { blobs: string[]; doubles: number[]; indexes: string[] }[] = [];
  const messages: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => messages.push(String(message));
  try {
    observeRequest(
      { writeDataPoint: (point) => points.push(point) },
      {
        requestId: 'request-uuid',
        method: 'GET',
        pathname: '/api/rooms',
        status: 200,
        durationMs: 12.345,
      },
    );
  } finally {
    console.log = originalLog;
  }
  assert.deepEqual(points[0], {
    blobs: ['http.request', 'api.rooms', 'GET', '2xx'],
    doubles: [12.345, 1, 200],
    indexes: ['17mah-jong'],
  });
  assert.match(messages[0], /"event":"http.request"/);
  assert.match(messages[0], /"requestId":"request-uuid"/);
  assert.doesNotMatch(messages[0], /token|cookie|email|SECRET/i);
});

test('operational alerts get distinct room-conflict, auth, and database-health events', () => {
  const warnings: string[] = [];
  const errors: string[] = [];
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (message?: unknown) => warnings.push(String(message));
  console.error = (message?: unknown) => errors.push(String(message));
  try {
    observeRequest(undefined, {
      requestId: 'room-conflict',
      method: 'PATCH',
      pathname: '/api/rooms',
      status: 409,
      durationMs: 2,
    });
    observeRequest(undefined, {
      requestId: 'auth-failure',
      method: 'POST',
      pathname: '/api/auth',
      status: 401,
      durationMs: 3,
    });
    observeRequest(undefined, {
      requestId: 'database-failure',
      method: 'GET',
      pathname: '/api/health',
      status: 503,
      durationMs: 4,
    });
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
  assert.deepEqual(
    warnings.map((message) => JSON.parse(message).event),
    ['room.state_conflict', 'auth.anomaly'],
  );
  assert.deepEqual(
    errors.map((message) => JSON.parse(message).event),
    ['http.request', 'api.server_error'],
  );
  assert.equal(JSON.parse(errors[1]).category, 'database_health_check_failed');
});
