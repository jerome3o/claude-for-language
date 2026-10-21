import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * "Everyday words before formal ones" (shared/decks/formality.ts, Settings → New cards): with one
 * new card a day, the colloquial 搞定 (rarer in the frequency list) is introduced before the
 * formal 用餐 — whose new character 用 is far more common, so "Most common first" alone would pick
 * it. Turning the switch off in Settings brings back the frequency order.
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

test('an everyday word comes before a formal one; the switch turns it off', async ({ page, request }) => {
  test.setTimeout(150_000);
  const email = `everyday-first-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Everyday first' } });
  const token = auth.session_token;

  await api(request, '/api/profile/study-budget', { method: 'PUT', token, data: { new_cards_per_day: 1, secondary_cards_per_day: 0 } });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'Restaurant words' } });
  for (const [hanzi, pinyin, english] of [['用餐', 'yòngcān', 'to dine (formal)'], ['搞定', 'gǎodìng', 'to get it done']]) {
    await api(request, `/api/decks/${deck.id}/notes?check=none`, { method: 'POST', token, data: { hanzi, pinyin, english } });
  }

  await page.goto(`/decks?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await expect(page.getByText('Restaurant words')).toBeVisible({ timeout: 30000 });

  const firstNewWord = async (hanzi: string) => {
    await expect(async () => {
      await page.goto(`/study?deck=${deck.id}&autostart=true`);
      await expect(page.locator('.hanzi-large').first()).toHaveText(hanzi, { timeout: 5000 });
    }).toPass({ timeout: 60000 });
  };
  await firstNewWord('搞定');

  // Settings → New cards: the switch is on by default; off → the most common new character first.
  await page.goto('/settings');
  const toggle = page.getByTestId('nco-switch-everyday_first');
  await expect(toggle).toBeChecked({ timeout: 30000 });
  await page.getByTestId('nco-everyday_first').click();
  await expect(toggle).not.toBeChecked();
  await expect.poll(async () => (await api<{ new_card_order: { everyday_first: boolean } }>(request, '/api/auth/me', { token })).new_card_order.everyday_first)
    .toBe(false);
  await firstNewWord('用餐');
});
