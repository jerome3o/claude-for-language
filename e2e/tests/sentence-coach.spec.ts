import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Sentence Coach reliability: a dropped first request is retried on its own,
 * and a failure the retry can't fix says why and offers "Try again" with the
 * typed text kept. The coach's AI call is stubbed at the network level.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SENTENCE = '我的智能体在我们的app ostensibly加了视频电话功能';

async function seedUser(request: APIRequestContext) {
  const email = `coach-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const res = await request.post(`${API}/api/test/auth`, { data: { email, name: 'Coach Tester' } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { session_token: string };
}

const analysis = {
  kind: 'chinese',
  coach: {
    originalInput: SENTENCE,
    inputLanguage: 'chinese',
    isCorrect: false,
    corrected: { hanzi: '我的智能体给我们的应用加了视频通话功能。', pinyin: 'wǒ de zhìnéngtǐ gěi wǒmen de yìngyòng jiā le shìpín tōnghuà gōngnéng.', english: 'My agent added a video-call feature to our app.' },
    critique: '视频通话 is the usual word for a video call; 给…加 reads more naturally than 在…加.',
    issues: [],
    alternatives: [],
    vocabSuggestions: [],
  },
};

function conversationPayload() {
  const now = new Date().toISOString();
  const conversation = { id: 'conv-e2e', user_id: 'u', title: SENTENCE, input_language: 'zh', created_at: now, updated_at: now };
  return {
    conversation,
    messages: [
      { id: 'm1', conversation_id: 'conv-e2e', role: 'user', content_type: 'text', content: SENTENCE, created_at: now },
      { id: 'm2', conversation_id: 'conv-e2e', role: 'assistant', content_type: 'analysis', content: JSON.stringify(analysis), created_at: now },
    ],
  };
}

test('a dropped first request is retried automatically and the answer shows', async ({ page, request }) => {
  const { session_token } = await seedUser(request);
  let posts = 0;
  await page.route('**/api/coach/conversations', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts++;
    if (posts === 1) return route.abort('connectionreset');
    return route.fulfill({ json: conversationPayload() });
  });
  await page.route('**/api/coach/conversations/conv-e2e', (route) => route.fulfill({ json: conversationPayload() }));

  await page.goto(`/coach?session_token=${session_token}`);
  await page.locator('.sentence-input-form textarea').fill(SENTENCE);
  await page.locator('.sentence-input-form').getByTestId('coach-action-check').click();
  await expect(page.getByText('我的智能体给我们的应用加了视频通话功能。')).toBeVisible({ timeout: 15000 });
  expect(posts).toBe(2);
  await expect(page.getByTestId('coach-start-error')).toHaveCount(0);
});

test('a failure the retry cannot fix shows the reason and Try again, keeping the text', async ({ page, request }) => {
  const { session_token } = await seedUser(request);
  let posts = 0;
  await page.route('**/api/coach/conversations', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts++;
    if (posts <= 2) {
      return route.fulfill({ status: 503, json: { error: 'Claude is busy right now — try again in a moment.', retryable: true } });
    }
    return route.fulfill({ json: conversationPayload() });
  });
  await page.route('**/api/coach/conversations/conv-e2e', (route) => route.fulfill({ json: conversationPayload() }));

  await page.goto(`/coach?session_token=${session_token}`);
  await page.locator('.sentence-input-form textarea').fill(SENTENCE);
  await page.locator('.sentence-input-form').getByTestId('coach-action-check').click();
  const error = page.getByTestId('coach-start-error');
  await expect(error).toContainText('Claude is busy right now', { timeout: 15000 });
  expect(posts).toBe(2); // the first try + one automatic retry
  await expect(page.locator('textarea').first()).toHaveValue(SENTENCE);

  await error.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('我的智能体给我们的应用加了视频通话功能。')).toBeVisible({ timeout: 15000 });
});

const EXPLAINED = '我昨天去了商店买苹果';
const breakdown = {
  hanzi: EXPLAINED,
  pinyin: 'wǒ zuótiān qù le shāngdiàn mǎi píngguǒ',
  translation: 'I went to the shop yesterday to buy apples.',
  words: [
    { hanzi: '我', pinyin: 'wǒ', gloss: 'I' },
    { hanzi: '昨天', pinyin: 'zuótiān', gloss: 'yesterday' },
    { hanzi: '去了', pinyin: 'qù le', gloss: 'went' },
    { hanzi: '商店', pinyin: 'shāngdiàn', gloss: 'shop' },
    { hanzi: '买', pinyin: 'mǎi', gloss: 'buy' },
    { hanzi: '苹果', pinyin: 'píngguǒ', gloss: 'apples' },
  ],
  construction: 'Time word before the verb; 去 + place + verb says what you went there to do.',
};

test('Chinese offers Check and Explain; Explain shows the translation and word rows that add cards', async ({ page, request }) => {
  const { session_token } = await seedUser(request);
  let body: Record<string, unknown> | null = null;
  const now = new Date().toISOString();
  const payload = {
    conversation: { id: 'conv-explain', user_id: 'u', title: EXPLAINED, input_language: 'zh', action: 'explain', created_at: now, updated_at: now },
    messages: [
      { id: 'e1', conversation_id: 'conv-explain', role: 'user', content_type: 'text', content: EXPLAINED, created_at: now },
      { id: 'e2', conversation_id: 'conv-explain', role: 'assistant', content_type: 'analysis', content: JSON.stringify({ kind: 'explain', breakdown }), created_at: now },
    ],
  };
  await page.route('**/api/coach/conversations', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    body = route.request().postDataJSON();
    return route.fulfill({ json: payload });
  });
  await page.route('**/api/coach/conversations/conv-explain', (route) => route.fulfill({ json: payload }));

  // Empty box (the widget's ✏️ lands here): both buttons, disabled, nothing sent.
  await page.goto(`/coach?focus=1&session_token=${session_token}`);
  await expect(page.getByTestId('coach-action-check')).toBeDisabled();
  await expect(page.getByTestId('coach-action-explain')).toBeDisabled();

  // English → one Translate button.
  await page.locator('.sentence-input-form textarea').fill('How do I say I am running late?');
  await expect(page.getByTestId('coach-action-translate')).toBeEnabled();
  await expect(page.getByTestId('coach-action-explain')).toHaveCount(0);

  await page.locator('.sentence-input-form textarea').fill(EXPLAINED);
  await expect(page.getByTestId('coach-action-check')).toBeEnabled();
  await page.getByTestId('coach-action-explain').click();

  await expect(page.getByTestId('coach-explain-result')).toBeVisible({ timeout: 15000 });
  expect(body).toMatchObject({ text: EXPLAINED, action: 'explain' });
  await expect(page.getByText(breakdown.translation)).toBeVisible();
  await expect(page.locator('.coach-explain .sentence-set-word')).toHaveCount(6);
  // The follow-up chips still work after Explain.
  await expect(page.getByTestId('coach-quick-actions')).toBeVisible();

  await page.getByRole('button', { name: 'Add 商店 as a card' }).click();
  await expect(page.getByText('Save to deck:')).toBeVisible();
});
