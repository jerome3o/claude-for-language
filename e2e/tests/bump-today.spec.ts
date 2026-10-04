import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * "⚡ Study it today" (shared/decks/bumps.ts): in the Coach, Explain a sentence and try
 * to add a word I already have → the sheet says so and offers ⚡ Study it today → Home
 * says "⚡ 1 bumped for today" → the study session shows that card FIRST, over a daily
 * new-card budget of 0, with the ⚡ badge.
 *
 * Self-contained: seeds a user, a budget of 0 new cards, a deck with two notes, and stubs
 * the coach's AI call at the network level.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SENTENCE = '我下午去银行';

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

const breakdown = {
  hanzi: SENTENCE,
  pinyin: 'wǒ xiàwǔ qù yínháng',
  translation: 'I’m going to the bank this afternoon.',
  words: [
    { hanzi: '我', pinyin: 'wǒ', gloss: 'I' },
    { hanzi: '下午', pinyin: 'xiàwǔ', gloss: 'afternoon' },
    { hanzi: '去', pinyin: 'qù', gloss: 'go' },
    { hanzi: '银行', pinyin: 'yínháng', gloss: 'bank' },
  ],
  construction: 'Time word before the verb; 去 + place.',
};

test('Coach → a word I already have → ⚡ Study it today → Home → first in the session', async ({ page, request }) => {
  const email = `bump-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Bump learner' } });
  const token = auth.session_token;
  await api(request, '/api/profile/study-budget', { method: 'PUT', token, data: { new_cards_per_day: 0, secondary_cards_per_day: 0 } });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'HSK 2' } });
  for (const note of [
    { hanzi: '银行', pinyin: 'yínháng', english: 'bank', fun_facts: '银 (yín) silver · 行 (háng) a firm' },
    { hanzi: '苹果', pinyin: 'píngguǒ', english: 'apple', fun_facts: '苹 (píng) apple · 果 (guǒ) fruit' },
  ]) {
    await api(request, `/api/decks/${deck.id}/notes?check=none`, { method: 'POST', token, data: note });
  }

  const now = new Date().toISOString();
  const payload = {
    conversation: { id: 'conv-bump', user_id: 'u', title: SENTENCE, input_language: 'zh', action: 'explain', created_at: now, updated_at: now },
    messages: [
      { id: 'b1', conversation_id: 'conv-bump', role: 'user', content_type: 'text', content: SENTENCE, created_at: now },
      { id: 'b2', conversation_id: 'conv-bump', role: 'assistant', content_type: 'analysis', content: JSON.stringify({ kind: 'explain', breakdown }), created_at: now },
    ],
  };
  await page.route('**/api/coach/conversations', (route) =>
    route.request().method() === 'POST' ? route.fulfill({ json: payload }) : route.continue(),
  );
  await page.route('**/api/coach/conversations/conv-bump', (route) => route.fulfill({ json: payload }));

  // Sync the deck down first; nothing is due (budget 0).
  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('HSK 2').first()).toBeVisible({ timeout: 30000 });
  await page.goto('/');
  await expect(page.locator('.home-study-card')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('home-bumped')).toHaveCount(0);

  // Coach → Explain → add 银行, which I already have.
  await page.goto('/coach');
  await page.locator('.sentence-input-form textarea').fill(SENTENCE);
  await page.getByTestId('coach-action-explain').click();
  await expect(page.getByTestId('coach-explain-result')).toBeVisible({ timeout: 15000 });
  // The sentence's word I already have also gets the quick chip.
  await expect(page.getByTestId('coach-quick-bump')).toBeVisible();
  await page.getByRole('button', { name: 'Add 银行 as a card' }).click();
  await expect(page.getByTestId('already-have')).toContainText('You already have 银行 in HSK 2');
  await page.getByRole('button', { name: '⚡ Study it today' }).click();
  await expect(page.getByText('⚡ 银行 will come first in today’s study').first()).toBeVisible();

  // Home: one bumped word, and today's cards now hold its cards.
  await page.goto('/');
  await expect(page.getByTestId('home-bumped')).toHaveText('⚡ 1 bumped for today', { timeout: 30000 });

  // The session: 银行 first, with the ⚡ badge.
  await page.goto('/study?autostart=true');
  await expect(page.getByTestId('study-bump-badge')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.study-fullscreen')).toContainText('银行');
  await expect(page.locator('.study-fullscreen')).not.toContainText('苹果');

  // The server has it too (uploaded right away while online).
  const mine = await api<{ bumps: Array<{ hanzi: string; source: string }> }>(request, '/api/me/bumps', { token });
  expect(mine.bumps.map((b) => [b.hanzi, b.source])).toEqual([['银行', 'coach']]);
});
