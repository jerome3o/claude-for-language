import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * 📱 Phone practice (docs/PHONE_PRACTICE.md), hermetic: More → Phone practice → the easiest rail task
 * (stations by 简拼, the date, the train, 二等座, 选座 F, submit, pay with the pay password) and the
 * easiest food task (选规格 with a required-option error, 备注, 餐具, checkout, pay) end to end, then a
 * persona chat (the driver in ride-north-gate answers through the E2E stand-in) and long-press → the
 * language explorer.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

async function login(page: Page, request: APIRequestContext) {
  const email = `phone-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const res = await request.post(`${API}/api/test/auth`, { data: { email, name: 'Sam' } });
  expect(res.ok()).toBeTruthy();
  const { session_token: token } = (await res.json()) as { session_token: string };
  await page.goto(`/?session_token=${token}`);
  await page.waitForLoadState('networkidle');
}

/** The visible screen of the open app (screens below it stay mounted, hidden). */
const top = (page: Page) => page.locator('.ph-app:not([hidden]) .ph-layer-top');

async function pay(page: Page) {
  await page.getByTestId('pay-confirm').click();
  for (const d of '135790') await page.getByTestId(`key-${d}`).click();
  await expect(page.getByTestId('pay-success')).toBeVisible();
  await page.getByTestId('pay-done').click();
}

test.use({ viewport: { width: 412, height: 915 } });

test('rail: a Saturday ticket to Hangzhou, from the More page to the summary', async ({ page, request }) => {
  test.setTimeout(120_000);
  await login(page, request);
  await page.goto('/more');
  await page.getByRole('link', { name: /Phone practice/ }).click();
  await expect(page).toHaveURL(/\/phone$/);
  await page.locator('[data-testid="phone-scenario"][data-scenario="rail-hangzhou-saturday"]').click();

  await expect(page.getByTestId('phone-task-goal')).toContainText('Book one second-class');
  await page.getByTestId('phone-task-close').click();
  await page.getByTestId('home-app-rail').click();

  await page.getByTestId('rail-from').click();
  await page.getByTestId('rail-station-search').fill('shhq');
  await top(page).getByTestId('rail-station-option').first().click();
  await page.getByTestId('rail-to').click();
  await top(page).getByTestId('rail-station-search').fill('杭州东');
  await top(page).getByTestId('rail-station-option').first().click();
  await page.getByTestId('rail-date').click();
  await page.getByTestId('rail-day-2026-10-31').click();
  await page.getByTestId('rail-search').click();

  // The 08:52 D-train is before 9:00; G7311 at 09:12 is the one.
  await expect(top(page).getByTestId('rail-train-row').first()).toContainText('07:45');
  await top(page).locator('[data-testid="rail-train-row"][data-train="G7311"]').click();
  await top(page).locator('[data-testid="rail-seat-class"][data-class="二等座"]').getByTestId('rail-book').click();

  // Submitting with nobody ticked is refused like the real app.
  await top(page).getByTestId('rail-submit').click();
  await expect(page.getByTestId('phone-toast')).toHaveText('请选择乘车人');
  await top(page).getByTestId('rail-passenger').first().locator('input').check();
  await top(page).getByTestId('rail-seat-1F').click();
  await top(page).getByTestId('rail-submit').click();
  await page.getByTestId('rail-confirm-ok').click();
  await top(page).getByTestId('rail-pay').click();
  await pay(page);

  await expect(top(page).getByTestId('rail-order-status')).toContainText('支付成功');
  await expect(top(page).getByTestId('rail-seat')).toContainText(/F号/);
  await expect(page.getByTestId('phone-summary-title')).toHaveText('Task complete!', { timeout: 10_000 });
  await expect(page.getByTestId('phone-summary')).toContainText('Bonus: a window seat');
  await expect(page.getByTestId('phone-summary-word').first()).toContainText('出发地');

  await page.getByTestId('phone-back-to-list').click();
  await expect(page.locator('[data-testid="phone-scenario"][data-scenario="rail-hangzhou-saturday"]')).toContainText('✓ Done');
});

test('food: beef noodles your way to the office', async ({ page, request }) => {
  test.setTimeout(120_000);
  await login(page, request);
  await page.goto('/phone/food-beef-noodles');
  await page.getByTestId('phone-task-close').click();
  await page.getByTestId('home-app-food').click();
  await top(page).locator('[data-testid="food-shop"][data-shop="shop_lanzhou"]').click();
  await top(page).locator('[data-testid="food-item"][data-item="lamian"]').getByTestId('food-spec-open').click();

  const sheet = page.getByTestId('food-spec-sheet');
  await page.getByTestId('food-spec-add').click();
  await expect(page.getByTestId('phone-toast')).toHaveText('请选择辣度');
  await sheet.getByRole('button', { name: '中辣' }).click();
  await sheet.getByRole('button', { name: '细面' }).click();
  await sheet.getByRole('button', { name: /加蛋/ }).click();
  await page.getByTestId('food-spec-add').click();
  await top(page).getByTestId('food-checkout').click();

  await top(page).getByTestId('food-submit').click();
  await expect(page.getByTestId('phone-toast')).toHaveText('请选择餐具数量');
  await top(page).getByTestId('food-note').click();
  await top(page).getByTestId('food-note-tag').filter({ hasText: '不要香菜' }).click();
  await top(page).getByTestId('food-note-done').click();
  await top(page).getByTestId('food-cutlery').click();
  await page.getByTestId('food-cutlery-option').first().click();
  await expect(top(page).getByTestId('food-note')).toContainText('不要香菜');
  await top(page).getByTestId('food-submit').click();
  await pay(page);

  await expect(top(page).getByTestId('food-order')).toBeVisible();
  await expect(page.getByTestId('phone-summary-title')).toHaveText('Task complete!', { timeout: 10_000 });
  // Two slips: the missing 辣度 and the missing 餐具数量.
  await expect(page.getByTestId('phone-summary-mistakes')).toContainText('2 form or password slips');
});

test('a persona chat: the driver at the wrong gate answers, and long-press opens the explorer', async ({ page, request }) => {
  test.setTimeout(120_000);
  await login(page, request);
  await page.goto('/phone/ride-north-gate');
  await page.getByTestId('phone-task-close').click();
  await page.getByTestId('home-app-ride').click();
  await page.getByTestId('ride-where').click();
  await top(page).getByTestId('ride-search').fill('外滩');
  await top(page).locator('[data-testid="ride-poi"][data-poi="bund"]').click();
  await top(page).locator('[data-testid="ride-car"][data-car="快车"] input').uncheck();
  await top(page).locator('[data-testid="ride-car"][data-car="特惠快车"] input').check();
  await top(page).getByTestId('ride-call').click();

  await expect(top(page).locator('[data-testid="ride-trip"]')).toHaveAttribute('data-status', 'arrived', { timeout: 30_000 });
  await top(page).getByTestId('ride-chat').click();
  await expect(top(page).getByTestId('persona-chat')).toContainText('您在哪个门');

  // Long-press a word in the driver's message → the language explorer.
  const bubble = top(page).locator('.ph-msg-them .ph-msg-bubble').first();
  const box = (await bubble.boundingBox())!;
  await page.mouse.move(box.x + 12, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  await expect(page.getByTestId('explorer')).toBeVisible();
  await page.keyboard.press('Escape');

  await top(page).getByTestId('persona-input').fill('师傅，我在北门，延安西路这边，穿红色外套。');
  await top(page).getByTestId('persona-send').click();
  await expect(top(page).locator('.ph-msg-them')).toHaveCount(2, { timeout: 15_000 });
  await expect(top(page).getByTestId('persona-chat')).toContainText('北门');

  await page.getByTestId('phone-back').click();
  await expect(top(page).locator('[data-testid="ride-trip"]')).toHaveAttribute('data-status', 'finished', { timeout: 30_000 });
  await top(page).getByTestId('ride-pay').click();
  await pay(page);
  await expect(page.getByTestId('phone-summary-title')).toHaveText('Task complete!', { timeout: 10_000 });
});
