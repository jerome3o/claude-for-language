import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * "Words made of characters I know: start with English → Chinese" (shared/decks/lead-card.ts,
 * Settings → New cards): 学生 is a new word, but 学 (大学) and 生 (生活) are known — mature cards —
 * so the session opens it with its meaning_to_hanzi card (the English prompt) instead of showing
 * the characters. Turning the switch off in Settings brings back hanzi first.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const DAY = 86_400_000;

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

test('a new word of known characters starts with English → Chinese; the switch turns it off', async ({ page, request }) => {
  test.setTimeout(150_000);
  const email = `known-chars-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Known chars' } });
  const token = auth.session_token;

  const older = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'Older words' } });
  for (const [hanzi, pinyin, english] of [['大学', 'dàxué', 'university'], ['生活', 'shēnghuó', 'life']]) {
    const note = await api<{ id: string }>(request, `/api/decks/${older.id}/notes`, { method: 'POST', token, data: { hanzi, pinyin, english } });
    // Mature: every card reviewed Easy three times over the last half year.
    const { cards } = await api<{ cards: Array<{ id: string }> }>(request, `/api/notes/${note.id}`, { token });
    const events = cards.flatMap((c) => [200, 150, 40].map((daysAgo, i) => ({
      id: `e2e-${c.id}-${i}`, card_id: c.id, rating: 3, reviewed_at: new Date(Date.now() - daysAgo * DAY).toISOString(),
    })));
    await api(request, '/api/reviews', { method: 'POST', token, data: { events } });
  }
  // One new card a day: the blue pool holds exactly the note's first card.
  await api(request, '/api/profile/study-budget', { method: 'PUT', token, data: { new_cards_per_day: 1, secondary_cards_per_day: 0 } });
  const fresh = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'New words' } });
  await api(request, `/api/decks/${fresh.id}/notes`, { method: 'POST', token, data: { hanzi: '学生', pinyin: 'xuéshēng', english: 'student' } });

  await page.goto(`/decks?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await expect(page.getByText('Older words')).toBeVisible({ timeout: 30000 });

  // The first card of 学生 asks for it from the English — once the device has replayed the old
  // words' review events (until then they are new to it, and so are their characters).
  const english = page.getByText('student', { exact: true }).first();
  await expect(async () => {
    await page.goto(`/study?deck=${fresh.id}&autostart=true`);
    await expect(english).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 60000 });
  await expect(page.locator('.hanzi-large')).toHaveCount(0);

  // Settings → New cards: the switch, on by default; turn it off.
  await page.goto('/settings');
  const toggle = page.getByTestId('nco-switch-known_characters_english_first');
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toBeChecked();
  await page.getByTestId('nco-known_characters_english_first').click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByTestId('nco-reset')).toBeVisible();

  // Now 学生 starts with its characters, as before.
  await page.goto(`/study?deck=${fresh.id}&autostart=true`);
  await expect(page.locator('.hanzi-large').filter({ hasText: '学生' })).toBeVisible({ timeout: 30000 });
});
