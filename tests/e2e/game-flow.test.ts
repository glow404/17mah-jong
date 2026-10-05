import assert from 'node:assert/strict';
import test from 'node:test';
import { suggestTenpaiHand } from '../../lib/mahjong';

const baseUrl = process.env.E2E_BASE_URL;
const password = 'E2e-test-password-17!';

type Credentials = { code: string; token: string; cookie: string };
type RoomSnapshot = {
  canRon: boolean;
  counts: [number, number];
  indicator: number;
  ownPool?: number[];
  ownRemaining?: number[];
  ownReady: boolean;
  result?: { kind: string } | null;
  seat: 0 | 1;
  turn: 0 | 1;
  version: number;
};

const observedVersions = new Map<string, number>();

async function register(email: string): Promise<{ cookie: string; user: { email: string } }> {
  const response = await fetch(new URL('/api/auth', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'register', email, password }),
  });
  if (response.status !== 201) {
    assert.fail(`registration failed: ${await response.text()}`);
  }
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie, 'registration should set a session cookie');
  return { cookie, user: (await response.json()) as { email: string } };
}

async function roomRequest(
  credentials: Credentials,
  method: 'GET' | 'PATCH',
  body?: Record<string, unknown>,
): Promise<RoomSnapshot> {
  let payload: Record<string, unknown> | undefined = body ? { ...credentials, ...body } : undefined;
  if (method === 'PATCH' && payload) {
    let version = observedVersions.get(credentials.token);
    if (version === undefined) version = (await roomRequest(credentials, 'GET')).version;
    payload = {
      ...payload,
      version: payload.version ?? version,
      actionId: payload.actionId ?? crypto.randomUUID(),
    };
  }
  const path =
    method === 'GET'
      ? `/api/rooms?code=${credentials.code}&token=${credentials.token}`
      : '/api/rooms';
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      cookie: credentials.cookie,
      'X-Game-Protocol': '2',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  if (!response.ok) {
    assert.fail(`${method} room request failed: ${await response.text()}`);
  }
  const snapshot = (await response.json()) as RoomSnapshot;
  observedVersions.set(credentials.token, snapshot.version);
  return snapshot;
}

test(
  'two registered players can select, pass ron, and reach the 17-discard draw',
  { skip: !baseUrl },
  async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const first = await register(`e2e-first-${suffix}@example.com`);
    const second = await register(`e2e-second-${suffix}@example.com`);

    const create = await fetch(new URL('/api/rooms', baseUrl), {
      method: 'POST',
      headers: {
        cookie: first.cookie,
        'content-type': 'application/json',
        'X-Game-Protocol': '2',
      },
      body: JSON.stringify({ action: 'create', baseScore: 1000 }),
    });
    if (create.status !== 201) {
      assert.fail(`room creation failed: ${await create.text()}`);
    }
    const created = (await create.json()) as { code: string; token: string };
    const firstCredentials: Credentials = { ...created, cookie: first.cookie };

    const join = await fetch(new URL('/api/rooms', baseUrl), {
      method: 'POST',
      headers: {
        cookie: second.cookie,
        'content-type': 'application/json',
        'X-Game-Protocol': '2',
      },
      body: JSON.stringify({ action: 'join', code: created.code }),
    });
    if (join.status !== 200) {
      assert.fail(`room join failed: ${await join.text()}`);
    }
    const joined = (await join.json()) as { code: string; token: string };
    const secondCredentials: Credentials = { ...joined, cookie: second.cookie };
    const credentials = [firstCredentials, secondCredentials];

    for (const [seat, current] of credentials.entries()) {
      const snapshot = await roomRequest(current, 'GET');
      assert.ok(snapshot.ownPool?.length === 34);
      const selected = suggestTenpaiHand(
        snapshot.ownPool,
        snapshot.indicator,
        seat === 0 ? 'east' : 'west',
      );
      assert.equal(selected?.length, 13);
      await roomRequest(current, 'PATCH', { action: 'select', selected });
    }

    let state = await roomRequest(firstCredentials, 'GET');
    for (let action = 0; action < 40 && !state.result; action += 1) {
      const actor = credentials[state.turn];
      const actorState = await roomRequest(actor, 'GET');
      assert.ok(actorState.ownRemaining?.length);
      const tileId = actorState.ownRemaining.at(-1);
      assert.notEqual(tileId, undefined);
      const discardAction = { action: 'discard', tileId, actionId: crypto.randomUUID() };
      state = await roomRequest(actor, 'PATCH', discardAction);
      const afterFirstDelivery = [...state.counts];
      const duplicateDelivery = await roomRequest(actor, 'PATCH', discardAction);
      assert.deepEqual(duplicateDelivery.counts, afterFirstDelivery);
      state = duplicateDelivery;

      const opponent = credentials[1 - state.turn];
      const opponentState = await roomRequest(opponent, 'GET');
      if (opponentState.canRon) {
        state = await roomRequest(opponent, 'PATCH', { action: 'pass' });
      }
      assert.ok(state.counts[0] <= 17 && state.counts[1] <= 17);
    }

    assert.equal(state.result?.kind, 'draw');
    assert.deepEqual(state.counts, [17, 17]);
  },
);
