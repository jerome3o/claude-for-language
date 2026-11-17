import { test, expect, APIRequestContext, Page, Locator } from '@playwright/test';

/**
 * Jerome (Nov 2026), on a word-order exercise: "it would be nice if I could click and drag and rearrange stuff so
 * that the order that I click them in isn't final." docs/STUDY_SESSION.md "Mini lessons" → "Word order":
 * - tiles placed by tapping can be DRAGGED to a new place in the answer (the others make a gap), and Check grades
 *   the new order;
 * - a pool tile can be dragged IN to a place (a tap still appends it);
 * - a placed tile dragged back down to the pool comes out;
 * - the arrow keys move a focused placed tile.
 * SCRAMBLE_DRAG_SHOTS=<dir> also saves phone-size screenshots there (PR screenshots).
 */
test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined }, viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SHOTS = process.env.SCRAMBLE_DRAG_SHOTS;

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
  title: 'Word order · drag',
  icon: '🧩',
  sections: [{
    exercises: [
      {
        type: 'scramble',
        english: 'He left the company he had worked at for fifteen years.',
        tiles: ['他', '工作了', '的', '十五年', '公司', '离开了'],
        correct_order: ['他', '离开了', '工作了', '十五年', '的', '公司'],
      },
      { type: 'scramble', english: 'As soon as he got home, he went to sleep.', tiles: ['睡觉了', '就', '一到家', '他'], correct_order: ['他', '一到家', '就', '睡觉了'] },
      { type: 'scramble', english: "I'm going to Beijing tomorrow.", tiles: ['北京', '去', '我', '明天'], correct_order: ['我', '明天', '去', '北京'] },
    ],
  }],
};

const poolTile = (page: Page, text: string) => page.locator('[data-testid="scramble-pool"] .tile:not(.ghost)', { hasText: new RegExp(`^${text}$`) });
const placed = (page: Page) => page.getByTestId('scramble-placed-tile');
const placedTile = (page: Page, text: string) => page.getByTestId('scramble-placed-tile').filter({ hasText: new RegExp(`^${text}$`) });

async function tap(page: Page, tiles: string[]) {
  for (const t of tiles) await poolTile(page, t).click();
}

async function center(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('no box');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
}

/** A mouse drag from `from` to (x, y) in small steps; `beforeUp` runs mid-drag (the gap is showing). */
async function dragTo(page: Page, from: Locator, x: number, y: number, beforeUp?: () => Promise<void>) {
  const s = await center(from);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(s.x + 4, s.y + 4, { steps: 2 });
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.move(x + 1, y, { steps: 1 });
  if (beforeUp) await beforeUp();
  await page.mouse.up();
}

test('word order: drag to rearrange, drag in, drag out, arrow keys — and Check grades the new order', async ({ page, request }) => {
  const email = `scramble-drag-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const created = await api<{ lesson: { id: string } } | { id: string }>(request, '/api/custom-lessons', { method: 'POST', token, data: { spec } });
  const id = 'lesson' in created ? created.lesson.id : created.id;

  const checks: string[] = [];
  await page.route('**/api/lessons/answer-check', async (route) => {
    checks.push(route.request().postData() ?? '');
    await route.continue();
  });

  await page.goto(`/lessons/${id}/play?from=lessons_page&session_token=${token}`);
  await expect(poolTile(page, '他')).toBeVisible({ timeout: 30_000 });

  // 1. Tapped in the order he thought of them — 他 工作了 十五年 的 公司 离开了 — then 离开了 dragged to after 他.
  await tap(page, ['他', '工作了', '十五年', '的', '公司', '离开了']);
  await expect(placed(page)).toHaveText(['他', '工作了', '十五年', '的', '公司', '离开了']);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-01-placed.png` });
  const target = await center(placedTile(page, '工作了'));
  await dragTo(page, placedTile(page, '离开了'), target.b.x + 6, target.y, async () => {
    // Mid-drag: a copy follows the pointer and the answer shows the gap where it will land.
    await expect(page.getByTestId('scramble-floating-tile')).toHaveText('离开了');
    await expect(page.getByTestId('scramble-gap')).toHaveCount(1);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-02-mid-drag.png` });
  });
  await expect(page.getByTestId('scramble-floating-tile')).toHaveCount(0);
  await expect(placed(page)).toHaveText(['他', '离开了', '工作了', '十五年', '的', '公司']);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-03-dropped.png` });
  // A plain tap still takes a tile out (and only that one).
  await placedTile(page, '公司').click();
  await expect(placed(page)).toHaveText(['他', '离开了', '工作了', '十五年', '的']);
  await poolTile(page, '公司').click();
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByTestId('lesson-result-banner')).toContainText('Correct');
  expect(checks).toHaveLength(0); // the listed order → right on the device, no Claude check
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // 2. Drag IN from the pool: 他 就 睡觉了 tapped, 一到家 dragged in between 他 and 就.
  await expect(poolTile(page, '一到家')).toBeVisible();
  await tap(page, ['他', '就', '睡觉了']);
  const jiu = await center(placedTile(page, '就'));
  await dragTo(page, poolTile(page, '一到家'), jiu.b.x + 4, jiu.y, async () => {
    await expect(page.getByTestId('scramble-gap')).toHaveCount(1);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-04-drag-in-from-pool.png` });
  });
  await expect(placed(page)).toHaveText(['他', '一到家', '就', '睡觉了']);
  // Drag OUT: 睡觉了 back down to the pool, then tapped back in at the end.
  const pool = await center(page.getByTestId('scramble-pool'));
  await dragTo(page, placedTile(page, '睡觉了'), pool.x, pool.y);
  await expect(placed(page)).toHaveText(['他', '一到家', '就']);
  await poolTile(page, '睡觉了').click();
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByTestId('lesson-result-banner')).toContainText('Correct');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // 3. Keyboard: 明天 我 去 北京 tapped; 我 focused and moved left with the arrow key.
  await expect(poolTile(page, '明天')).toBeVisible();
  await tap(page, ['明天', '我', '去', '北京']);
  await placedTile(page, '我').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(placed(page)).toHaveText(['我', '明天', '去', '北京']);
  await expect(placedTile(page, '我')).toBeFocused();
  await expect(placedTile(page, '我')).toHaveAttribute('aria-label', '我, 1 of 4');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByTestId('lesson-result-banner')).toContainText('Correct');
  expect(checks).toHaveLength(0);
});
