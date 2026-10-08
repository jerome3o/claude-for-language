import { test, expect, APIRequestContext, Locator, Page } from '@playwright/test';

/**
 * Ask Claude 🎧 Listen first (docs/STUDY_SESSION.md "Ask Claude"): the chat's listening mode in the
 * Ask Claude sheet. 🎧 in the header → my question shows, Claude's Chinese answer arrives as the
 * chat's hidden bubble and plays once by itself (the Read-aloud clip, POST /api/practice/tts);
 * a tap plays it again, a long press reveals it (word chips, no menu), the next long press opens
 * the chat's menu. An English answer is never hidden; Settings shows the same switch, saved on
 * the account.
 *
 * Claude and the TTS are replaced at the network edge (page.route on /api/notes/:id/ask, the word
 * chips and /api/practice/tts); the real worker handles sign-in, the deck, the sync and the
 * setting. The server-side clip pre-generation is covered by worker tests.
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

const ANSWER = '银行就是放钱的地方。我们常说：我去银行取钱。';
const ANSWER_WORDS = [
  { text: '银行', pinyin: 'yínháng', gloss: 'bank' },
  { text: '就是', pinyin: 'jiùshì', gloss: 'is exactly' },
  { text: '放', pinyin: 'fàng', gloss: 'to put' },
  { text: '钱', pinyin: 'qián', gloss: 'money' },
  { text: '的', pinyin: 'de', gloss: '' },
  { text: '地方', pinyin: 'dìfang', gloss: 'place' },
  { text: '。', pinyin: '', gloss: '' },
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
const QUESTION = '银行是什么意思？';
const EN_QUESTION = 'Can you explain it in English please?';
const EN_ANSWER = 'A **bank** (银行) is where money is kept.';

/** A tiny valid MP3 frame, so the browser can "play" it. */
const MP3 = Buffer.from('//uQZAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID///////////////////////////////////////////8AAAA8TEFNRTMuOTlyAc0AAAAAAAAAABSAJAKjQgAAgAAAAnGMHkkIAAAAAAAAAAAAAAAAAAAA', 'base64');

async function fakeClaude(page: Page, asks: Array<{ question: string; listening?: boolean }>, tts: Array<{ text: string; voice_id?: string; speed?: number }>) {
  let n = 0;
  await page.route('**/api/notes/*/ask', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}') as { question: string; listening?: boolean };
    asks.push(body);
    const english = body.question === EN_QUESTION;
    n++;
    await route.fulfill({
      status: 201,
      json: {
        id: `q-listen-${n}`,
        note_id: 'n',
        question: body.question,
        answer: english ? EN_ANSWER : ANSWER,
        asked_at: '2026-10-08 10:00:00',
        answer_lang: english ? 'en' : 'zh',
        answer_words: null,
        answer_translation: null,
        question_words: null,
        question_translation: null,
        question_check: null,
        question_check_pending: false,
        answer_clip_ready: !english && body.listening === true,
      },
    });
  });
  await page.route('**/api/note-questions/*/words', async (route) => {
    const { part } = JSON.parse(route.request().postData() || '{}') as { part: string };
    await route.fulfill({ json: { words: part === 'answer' ? ANSWER_WORDS : null, cached: false } });
  });
  await page.route('**/api/practice/tts', (route) => {
    tts.push(route.request().postDataJSON() as { text: string; voice_id?: string; speed?: number });
    return route.fulfill({ json: { audio_base64: MP3.toString('base64'), content_type: 'audio/mpeg' } });
  });
}

/** A touch long-press through pointer events (what the bubble listens to). */
async function longPress(target: Locator) {
  const box = (await target.boundingBox())!;
  const el = (await target.elementHandle())!;
  const init = { clientX: box.x + 16, clientY: box.y + 16, pointerType: 'touch', pointerId: 5, isPrimary: true, bubbles: true };
  await el.dispatchEvent('pointerdown', init);
  await target.page().waitForTimeout(700);
  await el.dispatchEvent('pointerup', init);
}

test('🎧 Listen first: the answer arrives hidden and plays by itself, tap plays, long-press reveals', async ({ page, request }) => {
  test.setTimeout(120_000);
  const email = `ask-listen-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: '银行练习' } });
  await api(request, `/api/decks/${deck.id}/notes`, { method: 'POST', token, data: { hanzi: '银行', pinyin: 'yínháng', english: 'bank', fun_facts: '银 (yín) silver · 行 (háng) business' } });

  const asks: Array<{ question: string; listening?: boolean }> = [];
  const tts: Array<{ text: string; voice_id?: string; speed?: number }> = [];
  await fakeClaude(page, asks, tts);
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

  // 🎧 in the header, beside 中文 | EN — off by default.
  const toggle = sheet.getByTestId('ask-listen-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByTestId('ask-hint')).toContainText('Listen first');
  // Saved on the account.
  await expect.poll(async () => (await api<{ ask_claude_listening?: boolean }>(request, '/api/auth/me', { token })).ask_claude_listening).toBe(true);
  if (process.env.SHOOT) await page.screenshot({ path: '../docs/pr-screenshots/ask-claude-listening/web-01-toggle.png' });

  await sheet.locator('textarea').fill(QUESTION);
  await sheet.locator('textarea').press('Enter');

  // My question shows; Claude's answer is the chat's hidden bubble.
  await expect(sheet.getByTestId('ask-mine')).toContainText(QUESTION);
  const hidden = sheet.getByTestId('ask-listening-bubble');
  await expect(hidden).toBeVisible({ timeout: 15000 });
  await expect(hidden).toContainText('Tap to listen · hold to reveal');
  await expect(sheet.getByText('就是放钱的地方')).toHaveCount(0);
  expect(asks[0].listening).toBe(true);

  // It plays once by itself — the Read-aloud clip in Claude's voice (the app voice, 0.6).
  await expect.poll(() => tts.filter((t) => t.text === ANSWER).length).toBe(1);
  expect(tts.find((t) => t.text === ANSWER)).toMatchObject({ voice_id: 'Chinese (Mandarin)_Radio_Host', speed: 0.6 });
  if (process.env.SHOOT) {
    await page.waitForTimeout(300);
    await page.screenshot({ path: '../docs/pr-screenshots/ask-claude-listening/web-02-hidden.png' });
  }

  // A tap plays it again (from the device cache — no second request), still hidden.
  await hidden.click();
  await page.waitForTimeout(300);
  await expect(sheet.getByText('就是放钱的地方')).toHaveCount(0);
  await expect(hidden).toBeVisible();

  // Long press → revealed: the word chips, and no message menu yet.
  await longPress(hidden);
  const reply = sheet.getByTestId('ask-claude-reply');
  await expect(reply.locator('.chat-word', { hasText: '取钱' })).toBeVisible();
  await expect(sheet.getByTestId('ask-listening-bubble')).toHaveCount(0);
  await expect(page.getByTestId('message-menu')).toHaveCount(0);
  if (process.env.SHOOT) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: '../docs/pr-screenshots/ask-claude-listening/web-03-revealed.png' });
  }

  // Now a long press opens the chat's menu as usual.
  await longPress(reply.locator('.chat-bubble'));
  await expect(page.getByTestId('message-menu')).toBeVisible();
  await page.getByTestId('message-menu').locator('[data-tool="copy"]').click();
  await expect(page.getByTestId('message-menu')).toHaveCount(0);

  // "In English please": an English answer is never hidden.
  await sheet.locator('textarea').fill(EN_QUESTION);
  await sheet.locator('textarea').press('Enter');
  await expect(sheet.getByText('is where money is kept')).toBeVisible({ timeout: 15000 });
  await expect(sheet.getByTestId('ask-listening-bubble')).toHaveCount(0);

  // Settings: the same switch.
  await page.goto('/settings');
  const section = page.getByTestId('ask-claude-listening');
  await expect(section).toBeVisible({ timeout: 30000 });
  await expect(section.locator('input')).toBeChecked();
  if (process.env.SHOOT) {
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: '../docs/pr-screenshots/ask-claude-listening/web-04-settings.png' });
  }
});
