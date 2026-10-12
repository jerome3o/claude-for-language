import { test, expect, APIRequestContext, Page, Locator } from '@playwright/test';

/**
 * "Up next" (shared/decks/up-next.ts): on the Up next page, search a card I already have and
 * add it at the top, search another and DRAG it into a place in the list, take one off (Undo
 * shows) — then Home says "↑ N up next" and the study session's one new card (budget 1) is
 * the first word of the list, though its deck is at the bottom of the deck queue.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PUT'; token?: string; data?: unknown } = {},
): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function holdAndDrag(page: Page, from: Locator, to: Locator) {
  await from.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 3, a.y + a.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(500); // press and hold: lifts after 350 ms
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(a.x + a.width / 3 + ((b.x + b.width / 3) - (a.x + a.width / 3)) * (i / steps), a.y + a.height / 2 + (b.y + b.height * 0.3 - (a.y + a.height / 2)) * (i / steps));
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

test('Up next: search → add on top → drag a word into place → remove → studied first within the budget', async ({ page, request }) => {
  const email = `upnext-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Up next learner' } });
  const token = auth.session_token;
  await api(request, '/api/profile/study-budget', { method: 'PUT', token, data: { new_cards_per_day: 1, secondary_cards_per_day: 0 } });
  // 苹果 / 学生 in the deck at the top of the queue; 银行 / 老师 in a deck below it.
  const low = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'Bank words' } });
  for (const note of [
    { hanzi: '银行', pinyin: 'yínháng', english: 'bank' },
    { hanzi: '老师', pinyin: 'lǎoshī', english: 'teacher' },
  ]) {
    await api(request, `/api/decks/${low.id}/notes?check=none`, { method: 'POST', token, data: note });
  }
  const top = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'Everyday' } });
  for (const note of [
    { hanzi: '苹果', pinyin: 'píngguǒ', english: 'apple' },
    { hanzi: '学生', pinyin: 'xuéshēng', english: 'student' },
  ]) {
    await api(request, `/api/decks/${top.id}/notes?check=none`, { method: 'POST', token, data: note });
  }
  await api(request, `/api/decks/${top.id}/move`, { method: 'POST', token, data: { to: 'top' } });

  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('Everyday').first()).toBeVisible({ timeout: 30000 });

  await page.goto('/up-next');
  await expect(page.getByTestId('upnext-empty')).toBeVisible({ timeout: 30000 });

  // Search 银行 → ＋ Top.
  await page.getByTestId('upnext-search').fill('银行');
  await page.getByRole('button', { name: 'Add 银行 at the top' }).click();
  await expect(page.getByTestId('upnext-list').locator('[data-upnext-row]')).toHaveCount(1);

  // 老师 and 学生 at the bottom, then drag 苹果 from the results into place 2 (onto 老师).
  await page.getByTestId('upnext-search').fill('老师');
  await page.getByRole('button', { name: 'Add 老师 at the bottom' }).click();
  await page.getByTestId('upnext-search').fill('学生');
  await page.getByRole('button', { name: 'Add 学生 at the bottom' }).click();
  const rows = page.getByTestId('upnext-list').locator('[data-upnext-row]');
  await expect(rows).toHaveCount(3);
  await page.getByTestId('upnext-search').fill('apple');
  const result = page.getByTestId('upnext-result').filter({ hasText: '苹果' });
  await expect(result).toBeVisible();
  await holdAndDrag(page, result, rows.nth(1));
  await expect(rows).toHaveCount(4);
  await expect(rows.locator('.upnext-hanzi')).toHaveText(['银行', '苹果', '老师', '学生']);

  // Press and hold 学生 and drag it to the top… then put 银行 back on top with ↑.
  await holdAndDrag(page, rows.nth(3), rows.nth(0));
  await expect(rows.locator('.upnext-hanzi')).toHaveText(['学生', '银行', '苹果', '老师']);
  await page.waitForTimeout(450); // a click right after a drag's release is swallowed (it would be the release)
  await page.getByRole('button', { name: 'Move 银行 to the top' }).click();
  await expect(rows.locator('.upnext-hanzi')).toHaveText(['银行', '学生', '苹果', '老师']);

  // Take 学生 off: Undo shows; the card is kept.
  await page.getByRole('button', { name: 'Take 学生 off Up next' }).click();
  await expect(page.getByTestId('upnext-toast')).toContainText('Removed 学生 from Up next');
  await expect(rows.locator('.upnext-hanzi')).toHaveText(['银行', '苹果', '老师']);

  // The server has the same order (sent right away while online).
  await expect.poll(async () => (await api<{ up_next: Array<{ hanzi: string }> }>(request, '/api/me/up-next', { token })).up_next.map((e) => e.hanzi), { timeout: 15000 })
    .toEqual(['银行', '苹果', '老师']);

  // Home: "↑ 3 up next".
  await page.goto('/');
  await expect(page.getByTestId('home-up-next')).toContainText('↑ 3 up next', { timeout: 30000 });

  // The session: budget 1 → the one new card is 银行, from the deck at the bottom of the queue.
  await page.goto('/study?autostart=true');
  await expect(page.locator('.study-fullscreen')).toContainText('银行', { timeout: 30000 });
  await expect(page.locator('.study-fullscreen')).not.toContainText('苹果');
});
