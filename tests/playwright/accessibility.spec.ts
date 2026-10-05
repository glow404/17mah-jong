import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function expectAccessible(page: import('@playwright/test').Page) {
  await page.waitForTimeout(250);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = results.violations.flatMap((violation) =>
    violation.nodes.map((node) => ({
      id: violation.id,
      target: node.target,
      summary: node.failureSummary,
    })),
  );
  expect(violations).toEqual([]);
}

test('onboarding, quick rules and the rules encyclopedia have no axe violations', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: '每局从 34 张牌开始' })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('button', { name: '跳过引导' }).click();
  await expectAccessible(page);

  const muteButton = page.getByRole('button', { name: '关闭声音' });
  await muteButton.click();
  await expect(page.getByRole('button', { name: '开启声音' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.reload();
  await expect(page.getByRole('button', { name: '开启声音' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  const quickRules = page.getByRole('button', { name: /规则说明/ });
  await quickRules.focus();
  await quickRules.click();
  await expect(page.getByRole('dialog', { name: '17 巡定胜负' })).toBeVisible();
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await expect(quickRules).toBeFocused();

  await quickRules.click();
  await page.getByRole('button', { name: '打开规则百科' }).click();
  await expect(page.getByRole('heading', { name: '役种与计分' })).toBeVisible();
  await expectAccessible(page);
});

test('responsive home and selection screens fit common device widths and support tile keys', async ({
  page,
}) => {
  const viewports = [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ];

  await page.addInitScript(() =>
    localStorage.setItem('17mah-jong:onboarding-complete:v1', 'complete'),
  );

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
    await expect(page.locator('[data-screen="home"]')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `home overflows at ${viewport.width}px`,
    ).toBe(true);

    const enableSoundButton = page.getByRole('button', { name: '关闭声音' });
    if (await enableSoundButton.isVisible()) await enableSoundButton.click();
    await page.getByRole('button', { name: '开始电脑对战' }).click();
    await expect(page.locator('[data-screen="selection"]')).toBeVisible({ timeout: 30_000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `selection overflows at ${viewport.width}px`,
    ).toBe(true);

    const tiles = page.locator('.pool-grid button.game-tile');
    await tiles.nth(0).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tiles.nth(1)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(tiles.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expectAccessible(page);

    await page.getByRole('button', { name: '智能推荐听牌' }).click();
    await page.getByRole('button', { name: /确认手牌/ }).click();
    await expect(page.locator('[data-screen="table"]')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `table overflows at ${viewport.width}px`,
    ).toBe(true);
  }
});

test('authentication dialog and a live game table have no axe violations', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
  const onboarding = page.getByRole('dialog', { name: '每局从 34 张牌开始' });
  if (await onboarding.isVisible().catch(() => false))
    await page.getByRole('button', { name: '跳过引导' }).click();

  const login = page.getByRole('button', { name: '邮箱登录' });
  await login.focus();
  await login.click();
  await expect(page.getByRole('dialog', { name: '登录后联机对战' })).toBeVisible();
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await expect(login).toBeFocused();

  await page.getByRole('button', { name: '关闭声音' }).click();
  await page.getByRole('button', { name: '开始电脑对战' }).click();
  await expect(page.locator('[data-screen="selection"]')).toBeVisible();
  await page.getByRole('button', { name: '智能推荐听牌' }).click();
  await page.getByRole('button', { name: /确认手牌，开始对局/ }).click();
  await expect(page.locator('[data-screen="table"]')).toBeVisible();
  await expectAccessible(page);
});
