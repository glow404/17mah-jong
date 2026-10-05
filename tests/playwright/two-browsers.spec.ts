import { expect, test } from '@playwright/test';

const password = 'Playwright-test-password-17!';

test('two browser contexts can create and join a room without leaking hidden state', async ({
  browser,
}) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const register = async (context: typeof first, email: string) => {
    const response = await context.request.post('/api/auth', {
      data: { action: 'register', email, password },
    });
    expect(response.status()).toBe(201);
  };
  await register(first, `pw-a-${suffix}@example.com`);
  await register(second, `pw-b-${suffix}@example.com`);
  const created = await first.request.post('/api/rooms', {
    data: { action: 'create', baseScore: 1000 },
  });
  expect(created.status()).toBe(201);
  const credentials = await created.json();
  const joined = await second.request.post('/api/rooms', {
    data: { action: 'join', code: credentials.code },
  });
  expect(joined.status()).toBe(200);
  const snapshot = await first.request.get(
    `/api/rooms?code=${credentials.code}&token=${credentials.token}`,
  );
  const body = await snapshot.json();
  expect(body.opponentHand).toBeUndefined();
  expect(body.uraIndicator).toBeUndefined();
  await first.close();
  await second.close();
});

test('guest can enter computer battle without authentication', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await expect(page.getByText('开始电脑对战')).toBeVisible();
  await page.getByText('开始电脑对战').click();
  await expect(page.locator('[data-screen="selection"]')).toBeVisible();
  await expect(page.getByText('电脑牌手')).toBeVisible();
});
