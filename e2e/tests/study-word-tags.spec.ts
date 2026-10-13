import { test, expect, APIRequestContext } from '@playwright/test';
import { skipFirstCardExplainer } from './fixtures/explainer';

// The first-card explainer is not what these tests are about (fixtures/explainer.ts).
test.beforeEach(async ({ context }) => skipFirstCardExplainer(context));

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

test('AI word tags: a ✨ pill where the lexicon has nothing, and its sheet says it is a suggestion', async ({ page, request }) => {
  const email = `tags-ai-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Tag learner' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: '告知练习' } });
  // E2E_TEST_MODE's fake model tags 告知: transitive, formal, with a note.
  const note = await api<{ id: string }>(request, `/api/decks/${deck.id}/notes`, {
    method: 'POST', token, data: { hanzi: '告知', pinyin: 'gàozhī', english: 'to inform', fun_facts: '告 (gào) to tell · 知 (zhī) to know' },
  });
  // Tagged on the queue after the create; the on-demand backfill covers a slow queue.
  await expect
    .poll(async () => {
      const n = await api<{ word_tags?: string | null }>(request, `/api/notes/${note.id}`, { token });
      if (!n.word_tags) await api(request, '/api/notes/word-tags/backfill', { method: 'POST', token, data: { limit: 10 } }).catch(() => {});
      return n.word_tags ?? null;
    }, { timeout: 30000, intervals: [500, 1000, 2000] })
    .toContain('"transitivity":"transitive"');

  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('告知练习').first()).toBeVisible({ timeout: 30000 });
  await page.goto(`/study?deck=${deck.id}&autostart=true`);
  const skip = page.getByTestId('skip-recording');
  await expect(skip).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(500);
  const explainer = page.getByRole('button', { name: 'Got it' });
  if (await explainer.isVisible().catch(() => false)) await explainer.click();
  await skip.click();

  const tags = page.getByTestId('study-card-back').getByTestId('word-tags');
  await expect(tags).toContainText('Verb');
  await expect(tags).toContainText('Takes an object');
  await expect(tags.locator('[data-ai="true"]')).toHaveCount(2);
  await tags.getByRole('button', { name: 'Formal (suggested by AI)' }).click();
  const sheet = page.getByTestId('word-tag-sheet');
  await expect(sheet.getByTestId('word-tag-sheet-ai')).toContainText('Suggested by AI — may be wrong');
  await expect(sheet.getByTestId('word-tag-sheet-note')).toHaveText('formal written; in speech use 告诉');
});

test('Everyday speech: 结账 loses its "Rare" pill (written text undercounts it)', async ({ page, request }) => {
  const email = `tags-everyday-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Tag learner' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: '饭馆' } });
  // E2E_TEST_MODE's fake model calls 结账 everyday speech (high spoken confidence).
  const note = await api<{ id: string }>(request, `/api/decks/${deck.id}/notes`, {
    method: 'POST', token, data: { hanzi: '结账', pinyin: 'jiézhàng', english: 'to settle the bill', fun_facts: '结 (jié) to settle · 账 (zhàng) account' },
  });
  await expect
    .poll(async () => {
      const n = await api<{ word_tags?: string | null }>(request, `/api/notes/${note.id}`, { token });
      if (!n.word_tags) await api(request, '/api/notes/word-tags/backfill', { method: 'POST', token, data: { limit: 10 } }).catch(() => {});
      return n.word_tags ?? null;
    }, { timeout: 30000, intervals: [500, 1000, 2000] })
    .toContain('"spoken":"everyday"');

  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('饭馆').first()).toBeVisible({ timeout: 30000 });
  await page.goto(`/study?deck=${deck.id}&autostart=true`);
  const skip = page.getByTestId('skip-recording');
  await expect(skip).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(500);
  const explainer = page.getByRole('button', { name: 'Got it' });
  if (await explainer.isVisible().catch(() => false)) await explainer.click();
  await skip.click();

  const tags = page.getByTestId('study-card-back').getByTestId('word-tags');
  await expect(tags).toContainText('Everyday speech');
  await expect(tags).not.toContainText('Rare');
  await tags.getByRole('button', { name: 'Everyday speech (suggested by AI)' }).click();
  const sheet = page.getByTestId('word-tag-sheet');
  await expect(sheet).toContainText('daily life');
  await expect(sheet.getByTestId('word-tag-sheet-ai')).toContainText('Suggested by AI — may be wrong');
});
