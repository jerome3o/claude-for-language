import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * Jerome (Nov 2026): a word-order exercise, "As soon as the child saw the cake, he cheered up." He built
 * 一看见蛋糕孩子就高兴起来了 (natural — the subject only in the 就 clause) and got "✗ Not quite": the lesson listed only
 * 孩子一看见蛋糕就高兴起来了. docs/STUDY_SESSION.md "Word order — an order the lesson didn't list":
 * - an unlisted order of every tile, online → "Checking…" in place, then Claude (the E2E stand-in) says ✓ Also right —
 *   scored right, the expected order shown as "Also:" —
 * - an order that doesn't work → ✗ Not quite + Claude's one line;
 * - offline → today's strict ✗ Not quite at once, nothing asked.
 * SCRAMBLE_SHOTS=<dir> also saves phone-size screenshots there (PR screenshots).
 */
test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined }, viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SHOTS = process.env.SCRAMBLE_SHOTS;

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

const spec = {
  title: '一…就 · As soon as',
  icon: '🧩',
  sections: [{
    exercises: [
      { type: 'scramble', english: 'As soon as the child saw the cake, he cheered up.', tiles: ['高兴起来了', '孩子', '就', '蛋糕', '一看见'], correct_order: ['孩子', '一看见', '蛋糕', '就', '高兴起来了'] },
      { type: 'scramble', english: "I'm going to Beijing tomorrow.", tiles: ['北京', '去', '我', '明天'], correct_order: ['我', '明天', '去', '北京'] },
      { type: 'scramble', english: 'As soon as he got home, he went to sleep.', tiles: ['睡觉了', '就', '一到家', '他'], correct_order: ['他', '一到家', '就', '睡觉了'] },
    ],
  }],
};

async function build(page: Page, tiles: string[]) {
  for (const tile of tiles) {
    await page.locator('.scramble-row.pool .tile:not(.ghost)', { hasText: new RegExp(`^${tile}$`) }).click();
  }
  await page.getByRole('button', { name: 'Check', exact: true }).click();
}

test('an order the lesson didn\'t list: Checking… → ✓ Also right; a wrong one → ✗ + Claude\'s reason; offline → ✗ at once', async ({ page, request }) => {
  const email = `scramble-check-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const created = await api<{ lesson: { id: string } } | { id: string }>(request, '/api/custom-lessons', { method: 'POST', token, data: { spec } });
  const id = 'lesson' in created ? created.lesson.id : created.id;

  const calls: string[] = [];
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/lessons/answer-check', async (route) => {
    calls.push(route.request().postData() ?? '');
    // The first check waits until the "Checking…" state has been seen.
    if (calls.length === 1) await held;
    await route.continue();
  });

  await page.goto(`/lessons/${id}/play?from=lessons_page&session_token=${token}`);
  await expect(page.locator('.scramble-row.pool .tile').first()).toBeVisible({ timeout: 30_000 });

  // 1. Jerome's order — not listed: "Checking…" in place, then ✓ Also right.
  await build(page, ['一看见', '蛋糕', '孩子', '就', '高兴起来了']);
  const banner = page.getByTestId('lesson-result-banner');
  await expect(banner).toHaveText('Checking…');
  await expect(page.getByTestId('answer-check-checking')).toBeVisible();
  await expect(page.getByTestId('scramble-correct-sentence')).toBeVisible();
  await expect(page.getByText('The expected order:')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-checking.png` });
  release();
  await expect(banner).toContainText('✓ Also right', { timeout: 15_000 });
  await expect(page.getByTestId('answer-check-checking')).toHaveCount(0);
  await expect(page.getByText('Also:', { exact: true })).toBeVisible();
  await expect(page.getByTestId('scramble-claude-note')).toContainText('孩子');
  expect(JSON.parse(calls[0])).toMatchObject({ exercise_type: 'scramble', answer: '一看见 蛋糕 孩子 就 高兴起来了', model_answer: '孩子 一看见 蛋糕 就 高兴起来了' });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-also-right.png` });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // 2. An order that doesn't work → ✗ Not quite + Claude's one line.
  await build(page, ['去', '北京', '我', '明天']);
  await expect(banner).toContainText('✗ Not quite', { timeout: 15_000 });
  await expect(page.getByText('The right order:')).toBeVisible();
  await expect(page.getByTestId('scramble-claude-note')).toContainText('start with 我');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-not-quite.png` });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // 3. Offline: the strict verdict at once, nothing asked.
  await expect(page.locator('.scramble-row.pool .tile', { hasText: /^一到家$/ })).toBeVisible();
  await page.context().setOffline(true);
  await build(page, ['一到家', '他', '就', '睡觉了']);
  await expect(banner).toContainText('✗ Not quite');
  await expect(page.getByTestId('scramble-claude-note')).toHaveCount(0);
  await expect(page.getByTestId('answer-check-checking')).toHaveCount(0);
  expect(calls).toHaveLength(2);
  await page.context().setOffline(false);
});
