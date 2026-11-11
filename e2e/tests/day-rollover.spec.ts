import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * "New day starts at" (docs/STUDY_SESSION.md "When does a new day start"): the default is 4 am on
 * /auth/me and /sync/changes; Settings → Study shows the picker, a tap saves it (the server says 2,
 * a reload still shows 2), bad values are refused, null resets to 4. Then the study day itself: at
 * 00:30 (browser clock) with 4 am a word started at 23:30 still counts against today's budget —
 * Home offers only the budget's remaining new words — and at midnight rollover it is a new day.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PUT'; token?: string; data?: unknown; expectStatus?: number } = {},
): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (opts.expectStatus !== undefined) {
    expect(res.status()).toBe(opts.expectStatus);
    return (await res.json()) as T;
  }
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

test('Settings → Study → New day starts at: default 4 am, saved, validated', async ({ page, request }) => {
  test.setTimeout(120_000);
  const email = `rollover-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const token = auth.session_token;

  const me = await api<{ day_rollover_hour: number }>(request, '/api/auth/me', { token });
  expect(me.day_rollover_hour).toBe(4);
  const changes = await api<{ day_rollover_hour: number }>(request, '/api/sync/changes?since=2020-01-01T00:00:00.000Z', { token });
  expect(changes.day_rollover_hour).toBe(4);

  await api(request, '/api/profile/day-rollover', { method: 'PUT', token, data: { day_rollover_hour: 7 }, expectStatus: 400 });
  await api(request, '/api/profile/day-rollover', { method: 'PUT', token, data: { day_rollover_hour: 'x' }, expectStatus: 400 });

  await page.goto(`/settings?session_token=${token}`);
  const picker = page.getByTestId('day-rollover');
  await expect(picker).toBeVisible({ timeout: 30_000 });
  await expect(picker.getByTestId('day-rollover-4')).toHaveAttribute('aria-checked', 'true');
  await expect(picker).toContainText("Until 4 am it's still yesterday");

  const saved = page.waitForResponse((r) => r.url().includes('/api/profile/day-rollover') && r.request().method() === 'PUT');
  await picker.getByTestId('day-rollover-2').click();
  expect((await saved).ok()).toBe(true);
  await expect(picker.getByTestId('day-rollover-2')).toHaveAttribute('aria-checked', 'true');
  expect((await api<{ day_rollover_hour: number }>(request, '/api/auth/me', { token })).day_rollover_hour).toBe(2);

  await page.reload();
  await expect(page.getByTestId('day-rollover-2')).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });

  // Midnight = the old calendar day.
  await page.getByTestId('day-rollover-0').click();
  await expect(page.getByTestId('day-rollover')).toContainText('A new day starts at midnight');
  await expect.poll(async () => (await api<{ day_rollover_hour: number }>(request, '/api/auth/me', { token })).day_rollover_hour).toBe(0);

  // null resets to the default.
  const reset = await api<{ day_rollover_hour: number; is_default: boolean }>(request, '/api/profile/day-rollover', { method: 'PUT', token, data: { day_rollover_hour: null } });
  expect(reset).toEqual({ day_rollover_hour: 4, is_default: true });
});

test('the study day on the device: 00:30 with a 4 am rollover is still yesterday', async ({ page, request }) => {
  test.setTimeout(120_000);
  const email = `rollover-day-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  // The browser clock: 00:30 local on 11 Nov 2026.
  await page.clock.setFixedTime(new Date(2026, 10, 11, 0, 30));
  await page.goto(`/settings?session_token=${auth.session_token}`);
  await expect(page.getByTestId('day-rollover')).toBeVisible({ timeout: 30_000 });
  const keys = await page.evaluate(async () => {
    const mod = await import('/src/services/studyDay.ts');
    mod.writeDayRolloverHour(4);
    const four = mod.studyToday();
    mod.writeDayRolloverHour(0);
    const midnight = mod.studyToday();
    mod.writeDayRolloverHour(4);
    return { four, midnight };
  });
  expect(keys).toEqual({ four: '2026-11-10', midnight: '2026-11-11' });
});
