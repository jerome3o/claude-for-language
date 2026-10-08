import { test, expect, APIRequestContext, Locator, Page } from '@playwright/test';

/**
 * Ask Claude, immersion (docs/STUDY_SESSION.md "Ask Claude"): on the card back, Ask Claude
 * opens in 中文; I ask in Chinese → Claude's reply is a grey bubble of word chips (tap 银行 →
 * the language explorer), my own question gets the chat's ✎ + "Open in Coach" chip (the
 * auto-check), and a long press on the reply opens the chat's message menu → Translate shows
 * the English under it.
 *
 * Claude is replaced at the network edge (page.route on /api/notes/:id/ask, /api/note-questions/
 * :id/words and /translate) — the real worker handles sign-in, the deck and the sync; the
 * worker side of the ask (language, check, chips) is covered by worker tests.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

const ANSWER = '银行就是放钱的地方。\n我们常说：我去银行取钱。';
const ANSWER_WORDS = [
  { text: '银行', pinyin: 'yínháng', gloss: 'bank' },
  { text: '就是', pinyin: 'jiùshì', gloss: 'is exactly' },
  { text: '放', pinyin: 'fàng', gloss: 'to put' },
  { text: '钱', pinyin: 'qián', gloss: 'money' },
  { text: '的', pinyin: 'de', gloss: '' },
  { text: '地方', pinyin: 'dìfang', gloss: 'place' },
  { text: '。', pinyin: '', gloss: '' },
  { text: '\n', pinyin: '', gloss: '' },
  { text: '我们', pinyin: 'wǒmen', gloss: 'we' },
  { text: '常', pinyin: 'cháng', gloss: 'often' },
  { text: '说', pinyin: 'shuō', gloss: 'say' },
  { text: '：', pinyin: '', gloss: '' },
  { text: '我', pinyin: 'wǒ', gloss: 'I' },
  { text: '去', pinyin: 'qù', gloss: 'go' },
  { text: '银行', pinyin: 'yínháng', gloss: 'bank' },
  { text: '取钱', pinyin: 'qǔ qián', gloss: 'withdraw money' },
  { text: '。', pinyin: '', gloss: '' },
];
const QUESTION = '银行是什么意？';
const CHECK = {
  text: QUESTION,
  status: 'improvable',
  corrected: '银行是什么意思？',
  corrected_pinyin: 'yínháng shì shénme yìsi',
  corrected_english: 'What does 银行 mean?',
  mistakes: [{ quote: '什么意', fix: '什么意思', why: 'The word is 意思.', card: null }],
  alternative: null,
  severity: 'moderate',
  card: null,
  checked_at: '2026-10-08T10:00:00.000Z',
};

async function fakeClaude(page: Page) {
  await page.route('**/api/notes/*/ask', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}') as { question: string; language?: string };
    expect(body.language).toBe('zh');
    await route.fulfill({
      status: 201,
      json: {
        id: 'q-1',
        note_id: 'n',
        question: body.question,
        answer: ANSWER,
        asked_at: '2026-10-08 10:00:00',
        answer_lang: 'zh',
        answer_words: null,
        answer_translation: null,
        question_words: null,
        question_translation: null,
        question_check: body.question === QUESTION ? CHECK : null,
        question_check_pending: false,
      },
    });
  });
  await page.route('**/api/note-questions/*/words', async (route) => {
    const { part } = JSON.parse(route.request().postData() || '{}') as { part: string };
    await route.fulfill({ json: { words: part === 'answer' ? ANSWER_WORDS : null, cached: false } });
  });
  await page.route('**/api/note-questions/*/translate', (route) =>
    route.fulfill({ json: { translation: 'A bank is a place where money is kept. We often say: I go to the bank to withdraw money.', cached: false } }),
  );
}

/** A touch long-press through pointer events (what the bubble listens to). */
async function longPress(target: Locator) {
  const box = (await target.boundingBox())!;
  const init = { clientX: box.x + 12, clientY: box.y + 12, pointerType: 'touch', pointerId: 5, isPrimary: true, bubbles: true };
  await target.dispatchEvent('pointerdown', init);
  await target.page().waitForTimeout(650);
  await target.dispatchEvent('pointerup', init);
}

test('Ask Claude answers in Chinese: word chips → explorer, ✎ + Open in Coach on my question, long-press → Translate', async ({ page, request }) => {
  test.setTimeout(120_000);
  const email = `ask-zh-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: '银行练习' } });
  await api(request, `/api/decks/${deck.id}/notes`, { method: 'POST', token, data: { hanzi: '银行', pinyin: 'yínháng', english: 'bank', fun_facts: '银 (yín) silver · 行 (háng) business' } });

  await fakeClaude(page);
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('银行练习').first()).toBeVisible({ timeout: 30000 });
  await page.goto(`/study?deck=${deck.id}&autostart=true`);

  const skip = page.getByTestId('skip-recording');
  await expect(skip).toBeVisible({ timeout: 30000 });
  const gotIt = page.getByRole('button', { name: 'Got it' });
  await page.waitForTimeout(500);
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await skip.click();
  await expect(page.getByTestId('study-card-back')).toBeVisible();

  await page.getByRole('button', { name: 'Ask Claude' }).click();
  const sheet = page.getByTestId('ask-claude-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('ask-lang-zh')).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByTestId('ask-hint')).toBeVisible();
  await expect(sheet.getByRole('button', { name: /造句/ })).toBeVisible();
  if (process.env.SHOOT) await page.screenshot({ path: '../docs/pr-screenshots/ask-claude-immersion/web-01-empty.png' });

  await sheet.locator('textarea').fill(QUESTION);
  await sheet.locator('textarea').press('Enter');

  // Claude's reply: word chips (made on the device at once), not Markdown.
  const reply = sheet.getByTestId('ask-claude-reply');
  await expect(reply.getByTestId('chat-words')).toBeVisible();
  await expect(reply.locator('.chat-word', { hasText: '地方' })).toBeVisible();

  // My question: the ✎ mark and the Open in Coach chip (the chat's auto-check).
  const mine = sheet.getByTestId('ask-mine');
  await expect(mine.getByTestId('chat-saybetter-mark')).toBeVisible();
  await expect(mine.getByTestId('chat-open-in-coach')).toBeVisible();
  if (process.env.SHOOT) await page.screenshot({ path: '../docs/pr-screenshots/ask-claude-immersion/web-02-reply.png' });

  // Tap a word → the language explorer's Word view.
  await reply.locator('.chat-word', { hasText: '银行' }).first().click();
  const explorer = page.getByTestId('explorer');
  await expect(explorer).toBeVisible();
  await expect(explorer).toContainText('银行');
  if (process.env.SHOOT) {
    await page.waitForTimeout(600);
    await page.screenshot({ path: '../docs/pr-screenshots/ask-claude-immersion/web-03-explorer.png' });
  }
  await page.getByTestId('explorer-close').click();
  await expect(explorer).toBeHidden();

  // Long-press the reply → the chat's menu, only the parts that fit → Translate.
  await longPress(reply.locator('.chat-bubble'));
  const menu = page.getByTestId('message-menu');
  await expect(menu).toBeVisible();
  // Copy · Translate · Pinyin · Explain · Save as flashcard · Open in Coach · Read aloud — no reactions, reply, pin…
  await expect(menu.locator('[data-tool]')).toHaveCount(7);
  await expect(menu.getByTestId('message-menu-reactions')).toHaveCount(0);
  if (process.env.SHOOT) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: '../docs/pr-screenshots/ask-claude-immersion/web-04-menu.png' });
  }
  await menu.locator('[data-tool="translate"]').click();
  await expect(reply.getByTestId('chat-translation')).toContainText('A bank is a place where money is kept');

  // My flagged question: How to say it better first in its menu → the sheet.
  await longPress(mine.locator('.chat-bubble'));
  await expect(menu.locator('[data-tool]').first()).toHaveAttribute('data-tool', 'say_better');
  await menu.locator('[data-tool="say_better"]').click();
  await expect(page.getByText('银行是什么意思？').first()).toBeVisible();
  if (process.env.SHOOT) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: '../docs/pr-screenshots/ask-claude-immersion/web-05-say-better.png' });
  }

  // Settings: "Ask Claude answers in" — 中文 by default.
  await page.goto('/settings');
  const section = page.getByTestId('ask-claude-language');
  await expect(section).toBeVisible({ timeout: 30000 });
  await expect(section.getByTestId('ask-claude-language-zh').locator('input')).toBeChecked();
  if (process.env.SHOOT) {
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: '../docs/pr-screenshots/ask-claude-immersion/web-06-settings.png' });
  }
});
