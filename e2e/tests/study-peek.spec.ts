import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * Peek: on the answer side, a tap on the card's empty space turns it back to the
 * question; a tap on the question returns to the answer. View only — nothing is
 * recorded, the ratings stay up, and buttons on the answer side keep their taps.
 *
 * Self-contained: seeds a user, a deck and one note through the E2E test-auth
 * endpoint and the public API.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {},
): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** How many review events this device holds (straight from IndexedDB). */
async function localReviewCount(page: Page): Promise<number> {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open('ChineseLearningDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = open.result.transaction('reviewEvents', 'readonly').objectStore('reviewEvents').count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  }));
}

test('peek: tap empty space on the answer to see the question, tap again to come back', async ({ page, request }) => {
  const email = `peek-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Peek learner' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: '打算练习' } });
  await api(request, `/api/decks/${deck.id}/notes`, {
    method: 'POST', token, data: { hanzi: '打算', pinyin: 'dǎsuàn', english: 'to plan; to intend', fun_facts: '打 (dǎ) to do · 算 (suàn) to reckon' },
  });

  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('打算练习').first()).toBeVisible({ timeout: 30000 });
  await page.goto(`/study?deck=${deck.id}&autostart=true`);

  // The read card: skip the recording straight to the answer.
  const skip = page.getByTestId('skip-recording');
  await expect(skip).toBeVisible({ timeout: 30000 });
  const gotIt = page.getByRole('button', { name: 'Got it' });
  await page.waitForTimeout(500);
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await skip.click();

  const back = page.getByTestId('study-card-back');
  const peek = page.getByTestId('study-peek-front');
  await expect(back).toBeVisible();
  await expect(back).toContainText('to plan; to intend');

  // A button on the answer side keeps its tap.
  await page.getByRole('button', { name: 'Play audio' }).click();
  await expect(back).toBeVisible();
  await expect(peek).toHaveCount(0);

  // Empty space → the question, with the ratings still there.
  await back.click({ position: { x: 4, y: 4 } });
  await expect(peek).toBeVisible();
  await expect(peek).toContainText('打算');
  await expect(peek).toContainText('Tap to see the answer');
  await expect(back).toBeHidden();
  await expect(page.getByRole('button', { name: /^Good/ }).first()).toBeVisible();

  // Tap the question → the answer again.
  await peek.click();
  await expect(back).toBeVisible();
  await expect(peek).toHaveCount(0);
  expect(await localReviewCount(page)).toBe(0);

  // Rating still works, once.
  await page.getByRole('button', { name: /^Good/ }).first().click();
  await expect.poll(() => localReviewCount(page), { timeout: 10000 }).toBe(1);
});
