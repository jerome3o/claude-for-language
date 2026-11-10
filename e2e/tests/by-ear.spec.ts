import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * "Start new words by ear" (shared/decks/lead-card.ts, Settings → New cards, ON by default): a new
 * word opens with its listening card (hear it, write it) instead of its characters. Turning the
 * switch off in Settings brings back the characters first. The test user keeps the real default
 * (`new_words_by_ear: true` on /api/test/auth — other specs get it off).
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

test('a new word starts with its listening card by default; the switch turns it off', async ({ page, request }) => {
  test.setTimeout(150_000);
  const email = `by-ear-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'By ear', new_words_by_ear: true } });
  const token = auth.session_token;

  // One new card a day: the blue pool holds exactly the note's lead card.
  await api(request, '/api/profile/study-budget', { method: 'PUT', token, data: { new_cards_per_day: 1, secondary_cards_per_day: 0 } });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'Listening' } });
  await api(request, `/api/decks/${deck.id}/notes`, { method: 'POST', token, data: { hanzi: '熊猫', pinyin: 'xióngmāo', english: 'panda' } });

  await page.goto(`/decks?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await expect(page.getByText('Listening')).toBeVisible({ timeout: 30000 });

  // The first card of 熊猫 is the listening card: the replay button, no characters, no English.
  const replay = page.getByRole('button', { name: 'Replay audio' });
  await expect(async () => {
    await page.goto(`/study?deck=${deck.id}&autostart=true`);
    await expect(replay).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 60000 });
  await expect(page.locator('.hanzi-large')).toHaveCount(0);

  // Settings → New cards: "Start new words by ear", on by default; turn it off.
  await page.goto('/settings');
  const toggle = page.getByTestId('nco-switch-new_words_by_ear');
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toBeChecked();
  await page.getByTestId('nco-new_words_by_ear').click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByTestId('nco-reset')).toBeVisible();

  // Now 熊猫 starts with its characters, as before.
  await page.goto(`/study?deck=${deck.id}&autostart=true`);
  await expect(page.locator('.hanzi-large').filter({ hasText: '熊猫' })).toBeVisible({ timeout: 30000 });
});
