import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * The Coach's "⚡ Study … today" chip (shared/decks/sentence-bumps.ts) never bumps a pile
 * of words in one tap:
 *   - a sentence whose words I have → "⚡ Study words from this today…" opens a picker,
 *     longest words first, NOTHING ticked; "⚡ Add 1 to today" bumps only what I ticked,
 *     and that row shows ⚡ (disabled) next time;
 *   - a sentence that is itself one of my cards → "⚡ Study this today" bumps only it.
 *
 * Self-contained: seeds a user and a deck, stubs the coach's AI call at the network level.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SENTENCE = '一对可爱的情侣在吃外卖。';
const OWN_SENTENCE = '我们一起吃外卖吧';

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

/** Stub the coach so Explain on `sentence` answers with a breakdown at once. */
async function stubCoach(page: Page, id: string, sentence: string) {
  const now = new Date().toISOString();
  const payload = {
    conversation: { id, user_id: 'u', title: sentence, input_language: 'zh', action: 'explain', created_at: now, updated_at: now },
    messages: [
      { id: `${id}-u`, conversation_id: id, role: 'user', content_type: 'text', content: sentence, created_at: now },
      {
        id: `${id}-a`, conversation_id: id, role: 'assistant', content_type: 'analysis', created_at: now,
        content: JSON.stringify({
          kind: 'explain',
          breakdown: { hanzi: sentence, pinyin: '', translation: 'A sentence.', words: [{ hanzi: sentence, pinyin: '', gloss: '' }], construction: '' },
        }),
      },
    ],
  };
  await page.unroute('**/api/coach/conversations').catch(() => undefined);
  await page.route('**/api/coach/conversations', (route) =>
    route.request().method() === 'POST' ? route.fulfill({ json: payload }) : route.continue(),
  );
  await page.route(`**/api/coach/conversations/${id}`, (route) => route.fulfill({ json: payload }));
}

async function explain(page: Page, sentence: string) {
  await page.goto('/coach');
  await page.locator('.sentence-input-form textarea').fill(sentence);
  await page.getByTestId('coach-action-explain').click();
  await expect(page.getByTestId('coach-explain-result')).toBeVisible({ timeout: 15000 });
}

test('Coach: pick which words of a sentence to study today; a sentence card bumps only itself', async ({ page, request }) => {
  const email = `coach-bump-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Picker learner' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'Everyday' } });
  for (const note of [
    { hanzi: '吃', pinyin: 'chī', english: 'to eat', fun_facts: '吃 (chī) eat' },
    { hanzi: '外卖', pinyin: 'wàimài', english: 'takeaway food', fun_facts: '外 (wài) outside · 卖 (mài) sell' },
    { hanzi: '可爱', pinyin: 'kě’ài', english: 'cute', fun_facts: '可 (kě) can · 爱 (ài) love' },
    { hanzi: '一对', pinyin: 'yí duì', english: 'a pair', fun_facts: '一 (yī) one · 对 (duì) pair' },
    { hanzi: '情侣', pinyin: 'qínglǚ', english: 'couple', fun_facts: '情 (qíng) feeling · 侣 (lǚ) companion' },
    { hanzi: OWN_SENTENCE, pinyin: 'wǒmen yìqǐ chī wàimài ba', english: 'Let’s get takeaway together.', fun_facts: '我们 (wǒmen) we · 一起 (yìqǐ) together · 吃 (chī) eat · 外卖 (wàimài) takeaway · 吧 (ba) suggestion' },
  ]) {
    await api(request, `/api/decks/${deck.id}/notes?check=none`, { method: 'POST', token, data: note });
  }

  // Sync the deck down first.
  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('Everyday').first()).toBeVisible({ timeout: 30000 });

  // A sentence with five of my words: a picker, not a one-tap bump of all five.
  await stubCoach(page, 'conv-words', SENTENCE);
  await explain(page, SENTENCE);
  const chip = page.getByTestId('coach-quick-bump');
  await expect(chip).toHaveText('⚡ Study words from this today…');
  await chip.click();
  const sheet = page.getByTestId('sentence-bump-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'You already have these words' })).toBeVisible();
  const rows = sheet.getByTestId('sentence-bump-row');
  await expect(rows).toHaveCount(5);
  await expect(rows.locator('.sentence-bump-hanzi')).toHaveText(['一对', '可爱', '情侣', '外卖', '吃']);
  await expect(rows.nth(3)).toContainText('wàimài');
  await expect(rows.nth(3)).toContainText('takeaway food');
  // Nothing ticked by default; the pinned button waits for a pick.
  for (let i = 0; i < 5; i++) await expect(rows.nth(i).locator('input')).not.toBeChecked();
  const add = sheet.getByTestId('sentence-bump-add');
  await expect(add).toBeDisabled();
  await rows.nth(3).click();
  await expect(add).toHaveText('⚡ Add 1 to today');
  await add.click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByText('⚡ 外卖 will come first in today’s study').first()).toBeVisible();

  // Opened again: 外卖 is already in today's study (⚡, disabled).
  await chip.click();
  await expect(rows.nth(3).locator('input')).toBeDisabled();
  await expect(rows.nth(3).locator('.sentence-bump-on')).toBeVisible();
  await expect(rows.nth(0).locator('input')).toBeEnabled();
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toHaveCount(0);

  // A sentence that is itself one of my cards: "⚡ Study this today" bumps only that note.
  await stubCoach(page, 'conv-own', OWN_SENTENCE);
  await explain(page, OWN_SENTENCE);
  await expect(chip).toHaveText('⚡ Study this today');
  await chip.click();
  await expect(chip).toHaveText('⚡ In today’s study');
  await expect(chip).toBeDisabled();

  // The server has exactly the two notes I chose.
  await expect.poll(async () => {
    const mine = await api<{ bumps: Array<{ hanzi: string; source: string }> }>(request, '/api/me/bumps', { token });
    return mine.bumps.map((b) => `${b.hanzi}:${b.source}`).sort();
  }, { timeout: 15000 }).toEqual([`${OWN_SENTENCE}:coach`, '外卖:coach'].sort());
});
