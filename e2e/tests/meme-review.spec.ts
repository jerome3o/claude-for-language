import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * 梗 Meme review (prototype; docs/MEME_REVIEW.md): an admin generates a month (the E2E stand-in
 * for the research agent, worker/src/services/meme-review/fake.ts, "searches" then hands in the
 * sample issue) → a learner opens it from More → Practice → expands a meme (meaning, origin, the
 * links out — the invented URL in the sample was dropped by the validator) → the quiz → "Make a
 * mini lesson" lands in their own Mini Lessons. A learner can't generate.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const MONTH = '2020-01';

async function call(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}) {
  return request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
}

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await call(request, path, opts);
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

test('meme review: admin generates → learner reads, expands, quizzes, makes a lesson', async ({ page, request }) => {
  test.setTimeout(150_000);
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const admin = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email: `meme-admin-${stamp}@test.e2e`, name: 'Admin', is_admin: true } });
  const learner = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email: `meme-${stamp}@test.e2e`, name: 'Jerome' } });

  // Only an admin may start one.
  expect((await call(request, '/api/meme-review/generate', { method: 'POST', token: learner.session_token, data: { month: MONTH } })).status()).toBe(403);
  await api(request, '/api/meme-review/generate', { method: 'POST', token: admin.session_token, data: { month: MONTH, regenerate: true } });
  await expect.poll(async () => (await api<{ issue: { status: string } }>(request, `/api/meme-review/${MONTH}`, { token: learner.session_token })).issue.status, { timeout: 60_000 }).toBe('ready');

  await page.goto(`/?session_token=${learner.session_token}`);
  await page.waitForLoadState('networkidle');
  await page.goto('/more');
  await page.getByRole('link', { name: /梗 Meme review · prototype/ }).click();
  await expect(page).toHaveURL(/\/meme-review$/);
  const row = page.getByTestId('meme-issue-row').filter({ hasText: '2020年1月' });
  await expect(row).toContainText('示例 · 梗回顾');
  await row.click();

  await expect(page.getByTestId('meme-issue-title')).toHaveText('示例 · 梗回顾');
  await expect(page.getByTestId('meme-card')).toHaveCount(6);
  await page.getByTestId('meme-card').filter({ hasText: '情绪价值' }).locator('.meme-card-toggle').click();
  const body = page.getByTestId('meme-card-body');
  await expect(body).toContainText('让别人开心');
  await expect(body).toContainText('dating and relationship talk shows');
  // Two real sources; the URL the sample "remembered" was never in the search results.
  await expect(body.getByTestId('meme-link-source')).toHaveCount(2);
  await expect(body.locator('a[href*="example.com"]')).toHaveCount(0);

  // The quiz (practice only).
  for (const q of await page.getByTestId('meme-quiz-question').all()) await q.locator('.meme-quiz-option').first().click();
  await expect(page.getByTestId('meme-quiz-score')).toContainText('/ 4');

  // A mini lesson in his own account.
  await page.getByTestId('meme-make-lesson').click();
  await expect(page.getByTestId('meme-lesson-open')).toBeVisible({ timeout: 30_000 });
  const lessons = await api<{ lessons: Array<{ title: string }> }>(request, '/api/custom-lessons', { token: learner.session_token });
  expect(lessons.lessons.map((l) => l.title)).toContain('梗 · January 2020 memes');
});
