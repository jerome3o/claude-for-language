import { test, expect, type APIRequestContext, type Locator } from '@playwright/test';
import { skipFirstCardExplainer } from './fixtures/explainer';

// The first-card explainer is not what these tests are about (fixtures/explainer.ts).
test.beforeEach(async ({ context }) => skipFirstCardExplainer(context));

/**
 * Ask Claude on a study card = the card's Claude THREAD in a sheet (docs/STUDY_SESSION.md "Ask
 * Claude"; components/claude/CardClaudeSheet.tsx). Against the real worker and its E2E stand-in
 * model (services/claude-agent/fake.ts: the answer streams in three chunks; the "Add a fun fact"
 * question makes it call edit_current_card) and the stand-in "check my Chinese"
 * (claude-agent/check-fake.ts: 什么意 without 思 is improvable):
 *
 * study a card → Ask Claude → the sheet ("📇 Asked on card · 银行", the card's chips, Ask only — no
 * Check / Explain) → my question streams a reply, my Chinese gets the ✎ check → the fun-fact chip:
 * Claude edits the card, "✓ Claude edited this card · Undo" and the card back shows the new notes →
 * Undo puts them back → the thread is in the Chats tab with its 📇 chip → the chip opens the card
 * hub, which links back to the conversation. Offline, a question waits ("Will send when you're
 * online") and is sent when the connection is back.
 *
 * ASK_CARD_SHOTS=<dir> also saves screenshots there (PR screenshots).
 */
const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SHOTS = process.env.ASK_CARD_SHOTS;
const FINAL = '有不懂的词，你可以点一下。';
const FUN_FACT = '(E2E) 小知识: Claude added this fun fact.';
const NOTES = '银 (yín) silver · 行 (háng) business';

test.use({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function seed(request: APIRequestContext) {
  const email = `ask-card-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: '银行练习' } });
  const note = await api<{ id: string }>(request, `/api/decks/${deck.id}/notes`, { method: 'POST', token, data: { hanzi: '银行', pinyin: 'yínháng', english: 'bank', fun_facts: NOTES } });
  return { token, deck, note };
}

/** Sign in, study the deck, flip the card. */
async function studyToBack(page: import('@playwright/test').Page, token: string, deckId: string) {
  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('银行练习').first()).toBeVisible({ timeout: 30_000 });
  await page.goto(`/study?deck=${deckId}&autostart=true`);
  const skip = page.getByTestId('skip-recording');
  await expect(skip).toBeVisible({ timeout: 30_000 });
  const gotIt = page.getByRole('button', { name: 'Got it' });
  await page.waitForTimeout(500);
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await skip.click();
  await expect(page.getByTestId('study-card-back')).toBeVisible();
}

async function typeQuestion(sheet: Locator, text: string) {
  const type = sheet.getByTestId('claude-chat-voice-type');
  if (await type.isVisible().catch(() => false)) await type.click(); // voice first: ✏️ Type opens the box
  await sheet.getByTestId('claude-chat-voice-text').fill(text);
  await sheet.getByTestId('claude-chat-voice-submit').click();
}

test('Ask Claude on a card: the card’s thread — streamed answer, ✎ check, Claude edits the card (Undo), in Chats, the chip opens the card hub', async ({ page, request }) => {
  test.setTimeout(180_000);
  const { token, deck, note } = await seed(request);
  await studyToBack(page, token, deck.id);

  await page.getByRole('button', { name: 'Ask Claude' }).click();
  const sheet = page.getByTestId('ask-claude-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('claude-thread-context-chip')).toContainText('Asked on card · 银行');
  await expect(sheet.getByTestId('claude-thread-lang-zh')).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByTestId('claude-thread-card-hint')).toBeVisible();
  // The card's suggestions; the composer asks only (no ✏️ Check / 🔍 Explain on a card).
  await expect(sheet.getByTestId('claude-thread-chip-sentences')).toContainText('造句');
  await expect(sheet.getByTestId('claude-thread-chip-fun_fact')).toBeVisible();
  await expect(sheet.getByTestId('claude-composer-intents')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-01-sheet-empty.png` });

  // My question → the reply streams in; my Chinese gets the chat's ✎ check.
  await typeQuestion(sheet, '银行是什么意？');
  await expect(sheet.getByTestId('claude-chat-streaming')).toContainText('这是一个好问题', { timeout: 20_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-02-streaming.png` });
  const reply = sheet.getByTestId('claude-chat-reply').last();
  await expect(reply).toContainText(FINAL, { timeout: 25_000 });
  await expect(reply.locator('.chat-word').first()).toBeVisible();
  const mine = sheet.getByTestId('claude-chat-mine').first();
  await expect(mine.getByTestId('chat-saybetter-mark')).toBeVisible({ timeout: 15_000 });
  await expect(mine.getByTestId('chat-open-in-coach')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-03-reply-check.png` });

  // Asking for a fun fact: Claude edits the card (the stand-in calls edit_current_card); the device follows.
  // (After a reply only the first three chips stay, so it is asked in the box.)
  await typeQuestion(sheet, '请给这张卡片加一个有意思的小知识。');
  const edited = sheet.getByTestId('card-claude-tool-edited');
  await expect(edited).toContainText('✓ Claude edited this card · notes', { timeout: 30_000 });
  await expect(sheet.getByTestId('card-claude-undo')).toBeVisible();
  if (SHOTS) {
    await edited.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/web-04-edited-undo.png` });
  }
  await sheet.getByTestId('claude-thread-close').click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('study-card-back')).toContainText('Claude added this fun fact');
  // Saved on the server too (the content service).
  const afterEdit = await api<{ fun_facts: string }>(request, `/api/notes/${note.id}`, { token });
  expect(afterEdit.fun_facts).toBe(FUN_FACT);

  // Undo: the notes as they were, on the card and on the server.
  await page.getByRole('button', { name: 'Ask Claude' }).click();
  await expect(sheet).toBeVisible();
  await sheet.getByTestId('card-claude-undo').click();
  await expect(edited).toContainText('Undone', { timeout: 15_000 });
  await sheet.getByTestId('claude-thread-close').click();
  await expect(page.getByTestId('study-card-back')).toContainText('silver');
  await expect(page.getByTestId('study-card-back')).not.toContainText('Claude added this fun fact');
  expect((await api<{ fun_facts: string }>(request, `/api/notes/${note.id}`, { token })).fun_facts).toBe(NOTES);

  // The Chats tab lists the card's thread with its 📇 emoji; its popover's "Open card ›" opens the card hub.
  await page.goto('/chats');
  const chip = page.getByRole('button', { name: 'Asked on card · 银行 — more' });
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await chip.click();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-05-chats-tab.png` });
  await page.getByTestId('chats-context-open').click();
  await expect(page).toHaveURL(new RegExp(`/cards/${note.id}$`));
  await expect(page.getByTestId('card-hub')).toBeVisible({ timeout: 20_000 });
  // The hub lists the card's conversation → it opens the thread.
  const row = page.getByTestId('card-claude-thread-row').first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  if (SHOTS) {
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/web-06-card-hub.png` });
  }
  await row.click();
  await expect(page).toHaveURL(/\/chats\/claude\/[^/?]+$/);
  await expect(page.getByTestId('claude-chat-reply').first()).toContainText(FINAL);
});

test('Ask Claude on a card offline: the question waits and is sent when the connection is back', async ({ page, request, context }) => {
  test.setTimeout(150_000);
  const { token, deck } = await seed(request);
  await studyToBack(page, token, deck.id);
  await context.setOffline(true);
  await page.getByRole('button', { name: /Ask Claude/ }).click();
  const sheet = page.getByTestId('ask-claude-sheet');
  await expect(sheet).toBeVisible();
  await typeQuestion(sheet, '银行和很行有什么不同？');
  await expect(sheet.getByTestId('claude-chat-queued')).toContainText('Will send when you’re online', { timeout: 10_000 });
  await expect(sheet.getByTestId('claude-chat-mine')).toContainText('银行和很行有什么不同？');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-07-offline-queued.png` });
  await context.setOffline(false);
  await expect(sheet.getByTestId('claude-chat-queued')).toHaveCount(0, { timeout: 20_000 });
  await expect(sheet.getByTestId('claude-chat-reply').last()).toContainText(FINAL, { timeout: 30_000 });
});

/** A tiny valid MP3 frame, so the browser can "play" it. */
const MP3 = Buffer.from('//uQZAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID///////////////////////////////////////////8AAAA8TEFNRTMuOTlyAc0AAAAAAAAAABSAJAKjQgAAgAAAAnGMHkkIAAAAAAAAAAAAAAAAAAAA', 'base64');

test('Ask Claude on a card, 🎧 Listen first: the answer arrives hidden, plays by itself, 👁 reveals the word chips', async ({ page, request }) => {
  test.setTimeout(150_000);
  const { token, deck } = await seed(request);
  const tts: Array<{ text: string; voice_id?: string; speed?: number }> = [];
  await page.route('**/api/practice/tts', (route) => {
    tts.push(route.request().postDataJSON() as { text: string; voice_id?: string; speed?: number });
    return route.fulfill({ json: { audio_base64: MP3.toString('base64'), content_type: 'audio/mpeg' } });
  });
  await studyToBack(page, token, deck.id);
  await page.getByRole('button', { name: 'Ask Claude' }).click();
  const sheet = page.getByTestId('ask-claude-sheet');
  const toggle = sheet.getByTestId('claude-thread-listen-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByTestId('claude-thread-card-hint')).toContainText('Listen first');
  // Saved on the account.
  await expect.poll(async () => (await api<{ ask_claude_listening?: boolean }>(request, '/api/auth/me', { token })).ask_claude_listening).toBe(true);

  await typeQuestion(sheet, '银行怎么用？');
  const hidden = sheet.getByTestId('claude-chat-listening-bubble');
  await expect(hidden).toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByText(FINAL)).toHaveCount(0);
  // It plays once by itself — the Read-aloud clip in Claude's voice.
  await expect.poll(() => tts.filter((t) => t.text.includes(FINAL)).length, { timeout: 15_000 }).toBe(1);
  expect(tts.find((t) => t.text.includes(FINAL))).toMatchObject({ voice_id: 'Chinese (Mandarin)_Radio_Host', speed: 0.6 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-08-listening-hidden.png` });
  await sheet.getByTestId('claude-chat-reveal').click();
  await expect(sheet.getByTestId('claude-chat-reply').last().locator('.chat-word').first()).toBeVisible();
  await expect(sheet.getByTestId('claude-chat-listening-bubble')).toHaveCount(0);
});
