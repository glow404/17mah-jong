import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

const password = 'Playwright-test-password-17!';
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';

async function register(context: BrowserContext, email: string) {
  const response = await context.request.post('/api/auth', {
    data: { action: 'register', email, password },
  });
  expect(response.status()).toBe(201);
}

async function readRoom(context: BrowserContext, credentials: { code: string; token: string }) {
  const response = await context.request.get(
    `/api/rooms?code=${credentials.code}&token=${credentials.token}`,
    { headers: { 'X-Game-Protocol': '2' } },
  );
  expect(response.status()).toBe(200);
  return response.json() as Promise<{
    counts: [number, number];
    pendingRon: 0 | 1 | null;
    result: { kind: string } | null;
    turn: 0 | 1;
  }>;
}

async function waitForRoomAction(
  page: Page,
): Promise<{ counts: [number, number]; version: number }> {
  const response = await page.waitForResponse(
    (candidate) =>
      candidate.url().includes('/api/rooms') &&
      candidate.request().method() === 'PATCH' &&
      candidate.status() === 200,
  );
  const body = await response.text();
  expect(response.status(), body).toBe(200);
  return JSON.parse(body) as { counts: [number, number]; version: number };
}

test('two browser contexts can create and join a room without leaking hidden state', async ({
  browser,
}) => {
  const first = await browser.newContext({ baseURL });
  const second = await browser.newContext({ baseURL });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await register(first, `pw-a-${suffix}@example.com`);
  await register(second, `pw-b-${suffix}@example.com`);
  const created = await first.request.post('/api/rooms', {
    data: { action: 'create', baseScore: 1000 },
    headers: { 'X-Game-Protocol': '2' },
  });
  expect(created.status()).toBe(201);
  const credentials = await created.json();
  const joined = await second.request.post('/api/rooms', {
    data: { action: 'join', code: credentials.code },
    headers: { 'X-Game-Protocol': '2' },
  });
  expect(joined.status()).toBe(200);
  const snapshot = await first.request.get(
    `/api/rooms?code=${credentials.code}&token=${credentials.token}`,
    { headers: { 'X-Game-Protocol': '2' } },
  );
  const body = await snapshot.json();
  expect(body.opponentHand).toBeUndefined();
  expect(body.uraIndicator).toBeUndefined();
  await first.close();
  await second.close();
});

test('two players finish a full game through reload and weak high-latency links', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const first = await browser.newContext({ baseURL });
  const second = await browser.newContext({ baseURL });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await register(first, `weak-a-${suffix}@example.com`);
  await register(second, `weak-b-${suffix}@example.com`);

  const create = await first.request.post('/api/rooms', {
    data: { action: 'create', baseScore: 1000 },
    headers: { 'X-Game-Protocol': '2' },
  });
  expect(create.status()).toBe(201);
  const firstCredentials = (await create.json()) as { code: string; token: string };
  const join = await second.request.post('/api/rooms', {
    data: { action: 'join', code: firstCredentials.code },
    headers: { 'X-Game-Protocol': '2' },
  });
  expect(join.status()).toBe(200);
  const secondCredentials = (await join.json()) as { code: string; token: string };
  const pages = [await first.newPage(), await second.newPage()];
  const credentials = [firstCredentials, secondCredentials];

  for (const [seat, page] of pages.entries()) {
    const roomCredentials = credentials[seat];
    await page.context().addInitScript((stored) => {
      sessionStorage.setItem('17mah-jong:active-room:v1', JSON.stringify(stored));
    }, roomCredentials);
    let failedFirstRead = false;
    await page.route('**/api/rooms**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 650));
      if (route.request().method() === 'GET' && !failedFirstRead) {
        failedFirstRead = true;
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    const observedReconnect = page
      .getByRole('status')
      .filter({ hasText: '同步暂时中断' })
      .waitFor({ state: 'visible', timeout: 15_000 });
    await page.goto('/');
    await observedReconnect;
    await expect(page.locator('[data-screen="selection"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('status').filter({ hasText: '同步暂时中断' })).toHaveCount(0, {
      timeout: 15_000,
    });
  }

  // Refresh while waiting: the tab-scoped credentials must restore this exact room.
  await pages[0].reload();
  await expect(pages[0].locator('[data-screen="selection"]')).toBeVisible();
  for (const page of pages) {
    await page.getByRole('button', { name: '智能推荐听牌' }).click();
    await page.getByRole('button', { name: /确认手牌/ }).click();
    await waitForRoomAction(page);
  }
  for (const page of pages) await expect(page.locator('[data-screen="table"]')).toBeVisible();

  let state = await readRoom(first, firstCredentials);
  let actions = 0;
  let refreshedMidGame = false;
  while (!state.result && actions < 40) {
    if (state.pendingRon !== null) {
      const responder = pages[state.pendingRon];
      await expect(responder.getByRole('button', { name: '放弃' })).toBeEnabled();
      const action = waitForRoomAction(responder);
      await responder.getByRole('button', { name: '放弃' }).click();
      await action;
    } else {
      const actor = pages[state.turn];
      await expect(actor.locator('.turn-notice')).toContainText('轮到你舍牌', {
        timeout: 10_000,
      });
      const reserve = actor.locator('.reserve-tiles [data-id]').last();
      await expect(reserve).toBeVisible();
      await reserve.click();
      const discardRequest =
        actions === 0
          ? actor.waitForRequest(
              (request) => request.url().includes('/api/rooms') && request.method() === 'PATCH',
            )
          : null;
      const action = waitForRoomAction(actor);
      await actor.getByRole('button', { name: /打出/ }).click();
      const applied = await action;
      if (discardRequest) {
        const original = await discardRequest;
        const duplicate = await actor.context().request.patch('/api/rooms', {
          data: original.postDataJSON(),
          headers: { 'X-Game-Protocol': '2' },
        });
        expect(duplicate.status()).toBe(200);
        const duplicateSnapshot = (await duplicate.json()) as typeof applied;
        expect(duplicateSnapshot.counts).toEqual(applied.counts);
        expect(duplicateSnapshot.version).toBe(applied.version);
      }
      actions += 1;
    }
    state = await readRoom(first, firstCredentials);

    if (!refreshedMidGame && state.counts[0] + state.counts[1] >= 6 && !state.result) {
      refreshedMidGame = true;
      await pages[0].reload();
      await expect(pages[0].locator('[data-screen="table"]')).toBeVisible({ timeout: 15_000 });
    }
  }

  expect(refreshedMidGame).toBe(true);
  expect(state.result?.kind).toBe('draw');
  expect(state.counts).toEqual([17, 17]);
  await Promise.all(pages.map((page) => page.unrouteAll({ behavior: 'wait' })));
  for (const page of pages) await page.close();
  await first.close();
  await second.close();
});

test('guest can enter computer battle without authentication', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await expect(page.getByText('开始电脑对战')).toBeVisible();
  await page.getByRole('button', { name: /开始电脑对战/ }).click();
  await expect(page.locator('[data-screen="selection"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('你的 34 张牌池')).toBeVisible();
});
