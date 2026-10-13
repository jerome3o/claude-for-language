import { test, expect, APIRequestContext } from '@playwright/test';
import { skipFirstCardExplainer } from './fixtures/explainer';

// The first-card explainer is not what these tests are about (fixtures/explainer.ts).
test.beforeEach(async ({ context }) => skipFirstCardExplainer(context));

/**
 * "New characters shimmer" (shared/study/newCharacters.ts, docs/STUDY_SESSION.md): 银子 was reviewed,
 * so 银 is seen; the new word 银行 arrives with ONLY 行 shimmering — on the read card's question and
 * on the answer side (the explorer's per-character tap targets intact). Settings → Study →
 * "Shimmer new characters" turns it off.
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

test('a never-seen character shimmers on the card; the switch turns it off', async ({ page, request }) => {
  test.setTimeout(150_000);
  const email = `new-char-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'New chars' } });
  const token = auth.session_token;

  const older = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'Older words' } });
  const silver = await api<{ id: string }>(request, `/api/decks/${older.id}/notes`, { method: 'POST', token, data: { hanzi: '银子', pinyin: 'yínzi', english: 'silver' } });
  const { cards } = await api<{ cards: Array<{ id: string }> }>(request, `/api/notes/${silver.id}`, { token });
  await api(request, '/api/reviews', {
    method: 'POST', token,
    data: { events: [{ id: `e2e-${cards[0].id}-0`, card_id: cards[0].id, rating: 2, reviewed_at: new Date(Date.now() - 3 * 86_400_000).toISOString() }] },
  });
  await api(request, '/api/profile/study-budget', { method: 'PUT', token, data: { new_cards_per_day: 1, secondary_cards_per_day: 0 } });
  const fresh = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'New words' } });
  await api(request, `/api/decks/${fresh.id}/notes`, { method: 'POST', token, data: { hanzi: '银行', pinyin: 'yínháng', english: 'bank' } });

  await page.goto(`/decks?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await expect(page.getByText('Older words')).toBeVisible({ timeout: 30000 });

  // Once the device has 银子's review, only 行 shimmers on 银行's read card.
  const front = page.locator('.hanzi-large').filter({ hasText: '银行' });
  await expect(async () => {
    await page.goto(`/study?deck=${fresh.id}&autostart=true`);
    await expect(front).toBeVisible({ timeout: 5000 });
    await expect(front.locator('.new-char')).toHaveText(['行'], { timeout: 3000 });
  }).toPass({ timeout: 60000 });
  await expect(page.locator('.new-char-sr')).toHaveText('New character: 行');

  // The answer side: still only 行, inside its own tap target.
  const explainer = page.getByRole('button', { name: 'Got it' });
  if (await explainer.isVisible().catch(() => false)) await explainer.click();
  await page.getByTestId('skip-recording').click();
  const back = page.getByTestId('study-card-back').locator('.hanzi-large');
  await expect(back.locator('.hanzi-char-clickable')).toHaveText(['银', '行']);
  await expect(back.locator('.new-char')).toHaveText(['行']);

  // Settings → Study → "Shimmer new characters": off.
  await page.goto('/settings');
  const toggle = page.getByTestId('new-char-shimmer-toggle');
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.goto(`/study?deck=${fresh.id}&autostart=true`);
  await expect(page.locator('.hanzi-large').filter({ hasText: '银行' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.new-char')).toHaveCount(0);
});
