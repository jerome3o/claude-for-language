import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Word tags (docs/STUDY_SESSION.md "Word tags"): the answer side shows small pills under the
 * meaning — part of speech, separable verb, HSK level… — from the shipped lexicon (no AI, no
 * network). A tap opens the explanation sheet without peeking the card; Settings → Study turns
 * them off.
 *
 * Self-contained: seeds a user, a deck and one note through the E2E test-auth endpoint and the
 * public API.
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

test('answer side: word tags under the meaning, tap one for what it means, off in Settings', async ({ page, request }) => {
  const email = `tags-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Tag learner' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: '睡觉练习' } });
  await api(request, `/api/decks/${deck.id}/notes`, {
    method: 'POST', token, data: { hanzi: '睡觉', pinyin: 'shuìjiào', english: 'to sleep', fun_facts: '睡 (shuì) to sleep · 觉 (jiào) a sleep' },
  });

  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('睡觉练习').first()).toBeVisible({ timeout: 30000 });
  await page.goto(`/study?deck=${deck.id}&autostart=true`);

  const skip = page.getByTestId('skip-recording');
  await expect(skip).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(500);
  const explainer = page.getByRole('button', { name: 'Got it' });
  if (await explainer.isVisible().catch(() => false)) await explainer.click();
  // The question side has no tags.
  await expect(page.getByTestId('word-tags')).toHaveCount(0);
  await skip.click();

  const back = page.getByTestId('study-card-back');
  await expect(back).toContainText('to sleep');
  const tags = back.getByTestId('word-tags');
  await expect(tags).toBeVisible();
  await expect(tags).toContainText('Verb');
  await expect(tags).toContainText('Separable verb');
  await expect(tags).toContainText('HSK 1');

  // A tap explains the tag — and the card stays on its answer side (no peek).
  await tags.getByRole('button', { name: 'Separable verb' }).click();
  const sheet = page.getByTestId('word-tag-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Separable verb 离合词');
  await expect(sheet).toContainText('睡了一个好觉');
  await sheet.getByRole('button', { name: 'Got it' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(back).toBeVisible();
  await expect(page.getByTestId('study-peek-front')).toHaveCount(0);

  // Settings → Study → off: the next answer shows no tags.
  await page.goto('/settings');
  const toggle = page.getByTestId('word-tags-toggle');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.goto(`/study?deck=${deck.id}&autostart=true`);
  // "Today is the session": the card may come back revealed, as it was left.
  const again = page.getByTestId('skip-recording').or(page.getByTestId('study-card-back'));
  await expect(again.first()).toBeVisible({ timeout: 30000 });
  if (await page.getByTestId('skip-recording').isVisible().catch(() => false)) await page.getByTestId('skip-recording').click();
  await expect(page.getByTestId('study-card-back')).toContainText('to sleep');
  await expect(page.getByTestId('word-tags')).toHaveCount(0);
});
