import assert from 'node:assert/strict';
import test from 'node:test';

const baseUrl = process.env.E2E_BASE_URL;
const password = 'Api-test-password-17!';

function url(path: string) {
  return new URL(path, baseUrl);
}

test(
  'health endpoint verifies D1 readiness and returns a request ID',
  { skip: !baseUrl },
  async () => {
    const response = await fetch(url('/api/health'));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('x-request-id') ?? '', /^[\da-f-]{36}$/i);
    assert.deepEqual(await response.json(), { status: 'ok' });
  },
);

async function auth(action: string, email: string, secret = password, cookie?: string) {
  return fetch(url('/api/auth'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ action, email, password: secret }),
  });
}

test(
  'auth API validates registration, login, session lookup, cookie flags, and logout',
  { skip: !baseUrl },
  async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const email = `api-${suffix}@example.com`;
    assert.equal((await auth('register', 'bad-email')).status, 400);
    const registered = await auth('register', email);
    assert.equal(registered.status, 201);
    const setCookie = registered.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /mahjong_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Max-Age=604800/i);
    const cookie = setCookie.split(';', 1)[0];
    assert.equal((await auth('register', email)).status, 400);
    assert.equal((await auth('login', email, 'wrong-password')).status, 401);
    const loggedIn = await auth('login', email);
    assert.equal(loggedIn.status, 200);
    const sessionCookie = (loggedIn.headers.get('set-cookie') ?? '').split(';', 1)[0] || cookie;
    const current = await fetch(url('/api/auth'), { headers: { cookie: sessionCookie } });
    assert.equal(current.status, 200);
    const currentBody = (await current.json()) as { user: { email: string } };
    assert.equal(currentBody.user.email, email);
    const loggedOut = await auth('logout', email, password, sessionCookie);
    assert.equal(loggedOut.status, 200);
    const revoked = await fetch(url('/api/auth'), { headers: { cookie: sessionCookie } });
    const revokedBody = (await revoked.json()) as { user: unknown };
    assert.equal(revokedBody.user, null);
  },
);

test(
  'room API rejects missing, duplicate, full-room, forged, and invalid actions',
  { skip: !baseUrl },
  async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const firstEmail = `room-a-${suffix}@example.com`;
    const secondEmail = `room-b-${suffix}@example.com`;
    const thirdEmail = `room-c-${suffix}@example.com`;
    const firstResponse = await auth('register', firstEmail);
    const secondResponse = await auth('register', secondEmail);
    const thirdResponse = await auth('register', thirdEmail);
    const firstCookie = (firstResponse.headers.get('set-cookie') ?? '').split(';', 1)[0];
    const secondCookie = (secondResponse.headers.get('set-cookie') ?? '').split(';', 1)[0];
    const thirdCookie = (thirdResponse.headers.get('set-cookie') ?? '').split(';', 1)[0];
    assert.equal((await fetch(url('/api/rooms'), { method: 'POST' })).status, 401);
    const create = await fetch(url('/api/rooms'), {
      method: 'POST',
      headers: { cookie: firstCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create', baseScore: 1000 }),
    });
    assert.equal(create.status, 201);
    const credentials = (await create.json()) as { code: string; token: string };
    assert.equal(
      (
        await fetch(url('/api/rooms'), {
          method: 'POST',
          headers: { cookie: firstCookie, 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'join', code: credentials.code }),
        })
      ).status,
      409,
    );
    const join = await fetch(url('/api/rooms'), {
      method: 'POST',
      headers: { cookie: secondCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'join', code: credentials.code }),
    });
    assert.equal(join.status, 200);
    const joined = (await join.json()) as { token: string };
    assert.equal(
      (
        await fetch(url('/api/rooms'), {
          method: 'POST',
          headers: { cookie: thirdCookie, 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'join', code: credentials.code }),
        })
      ).status,
      409,
    );
    const snapshot = await fetch(
      url(`/api/rooms?code=${credentials.code}&token=${credentials.token}`),
      { headers: { cookie: firstCookie } },
    );
    assert.equal(snapshot.status, 200);
    const visible = (await snapshot.json()) as Record<string, unknown>;
    assert.equal('opponentHand' in visible, false);
    assert.equal('uraIndicator' in visible, false);
    const forged = await fetch(url('/api/rooms'), {
      method: 'PATCH',
      headers: { cookie: firstCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ code: credentials.code, token: joined.token, action: 'ron' }),
    });
    assert.equal(forged.status, 403);
    const missing = await fetch(url('/api/rooms?code=NOPE&token=x'), {
      headers: { cookie: firstCookie },
    });
    assert.equal(missing.status, 404);
  },
);
