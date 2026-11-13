import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * The Claude thread view (docs/CHAT.md "Claude thread view"), web: `/chats/claude/new` (✏️ New chat →
 * Claude); the question creates a thread and the reply STREAMS in (the worker's E2E
 * stand-in writes it in three chunks a moment apart, pushed over the ChatHub socket / the poll);
 * Claude's Chinese is word chips → the language explorer; a card thread shows "📇 Asked on card ·
 * 银行" (→ the card hub) and the card's suggestion chips; offline, a message waits in the outbox
 * ("Waiting for a connection") and is sent when the connection is back.
 *
 * CLAUDE_THREAD_SHOTS=<dir> also saves screenshots there (PR screenshots).
 */
const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SHOTS = process.env.CLAUDE_THREAD_SHOTS;
const FINAL = '有不懂的词，你可以点一下。';

test.use({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });

async function seedUser(request: APIRequestContext) {
  const email = `claude-thread-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const res = await request.post(`${API}/api/test/auth`, { data: { email, name: 'Jerome' } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { session_token: string };
}

async function apiPost<T>(request: APIRequestContext, token: string, path: string, data: unknown): Promise<T> {
  const res = await request.post(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, data });
  expect(res.ok(), `${path} ${res.status()}`).toBeTruthy();
  return (await res.json()) as T;
}

test('a new chat: the reply streams into the thread view; words open the explorer', async ({ page, request }) => {
  test.setTimeout(120_000);
  const { session_token } = await seedUser(request);
  await page.goto(`/chats?session_token=${session_token}`);
  await expect(page.getByTestId('chats-compose')).toBeVisible({ timeout: 30_000 });
  await page.goto('/chats/claude/new');
  await expect(page.getByTestId('claude-thread-empty')).toBeVisible();
  await expect(page.getByTestId('claude-thread-chips')).toBeVisible();

  await page.getByTestId('claude-chat-voice-type').click();
  await page.getByTestId('claude-chat-voice-text').fill('成都有什么好吃的？');
  // A new chat offers ✏️ Check / 🔍 Explain beside Ask for Chinese.
  await expect(page.getByTestId('claude-composer-check')).toBeVisible();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL(/\/chats\/claude\/(?!new)[^/?]+$/, { timeout: 15_000 });

  // The reply grows: its first words show while it is still being written, then the whole of it.
  const streaming = page.getByTestId('claude-chat-streaming');
  await expect(streaming).toContainText('这是一个好问题', { timeout: 20_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-general-streaming.png` });
  const reply = page.getByTestId('claude-chat-reply').last();
  await expect(reply).toContainText(FINAL, { timeout: 20_000 });
  await expect(streaming).toHaveCount(0);
  await expect(reply.getByTestId('claude-chat-read-back')).toBeVisible();

  // A word → the language explorer.
  await reply.locator('.chat-word').first().click();
  await expect(page.getByTestId('explorer')).toBeVisible();
  await page.getByTestId('explorer-close').click();

  // Leaving and coming back keeps the thread (the Chats tab lists it as a Claude row); /coach/chat/:id redirects here.
  const url = page.url().replace(/^https?:\/\/[^/]+/, '');
  const id = url.split('/').pop()!;
  await page.goto('/chats');
  await expect(page.getByTestId('chats-claude-row').first()).toContainText('成都有什么好吃的', { timeout: 20_000 });
  await page.goto(`/coach/chat/${id}`);
  await expect(page).toHaveURL(new RegExp(`/chats/claude/${id}$`));
  await expect(page.getByTestId('claude-chat-reply').last()).toContainText(FINAL);
  await page.getByTestId('claude-thread-more').click();
  await expect(page.getByTestId('claude-thread-make-cards')).toBeEnabled();
});

test('a card thread: the header chip, the card’s chips, a streamed answer, the chip opens the card hub', async ({ page, request }) => {
  test.setTimeout(120_000);
  const { session_token } = await seedUser(request);
  const deck = await apiPost<{ id: string }>(request, session_token, '/api/decks', { name: 'HSK 2' });
  const note = await apiPost<{ id: string }>(request, session_token, `/api/decks/${deck.id}/notes`, { hanzi: '银行', pinyin: 'yínháng', english: 'bank' });
  await page.goto(`/chats?session_token=${session_token}`);
  await expect(page.getByTestId('chats-compose')).toBeVisible({ timeout: 30_000 });
  await page.goto(`/chats/claude/new?context=card&note_id=${note.id}&label=${encodeURIComponent('银行')}`);
  await expect(page.getByTestId('claude-thread-context-chip')).toContainText('Asked on card · 银行', { timeout: 30_000 });
  await expect(page.getByTestId('claude-composer-intents')).toHaveCount(0);
  await page.getByTestId('claude-thread-chip-sentences').click();
  await expect(page).toHaveURL(/\/chats\/claude\/(?!new)[^/?]+$/, { timeout: 15_000 });
  await expect(page.getByTestId('claude-chat-reply').last()).toContainText(FINAL, { timeout: 25_000 });
  // After the first message: no suggestion chips.
  await expect(page.getByTestId('claude-thread-chips')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-card-thread.png` });
  await page.getByTestId('claude-thread-context-chip').click();
  await expect(page).toHaveURL(new RegExp(`/cards/${note.id}$`));
  await expect(page.getByTestId('card-hub')).toBeVisible({ timeout: 20_000 });
});

test('a card Claude made: its word on the "✓ Added" line opens the explorer, the card is his, ⚡ Study it today works', async ({ page, request }) => {
  test.setTimeout(150_000);
  const { session_token } = await seedUser(request);
  const deck = await apiPost<{ id: string }>(request, session_token, '/api/decks', { name: 'HSK 2' });
  const note = await apiPost<{ id: string }>(request, session_token, `/api/decks/${deck.id}/notes`, { hanzi: '银行', pinyin: 'yínháng', english: 'bank' });
  await page.goto(`/chats?session_token=${session_token}`);
  await expect(page.getByTestId('chats-compose')).toBeVisible({ timeout: 30_000 });
  await page.goto(`/chats/claude/new?context=card&note_id=${note.id}&label=${encodeURIComponent('银行')}`);
  await expect(page.getByTestId('claude-thread-context-chip')).toContainText('Asked on card · 银行', { timeout: 30_000 });
  // The E2E stand-in calls create_flashcards (机会) when asked for a card.
  await page.getByTestId('claude-chat-voice-type').click();
  await page.getByTestId('claude-chat-voice-text').fill('Make a card for 机会');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL(/\/chats\/claude\/(?!new)[^/?]+$/, { timeout: 15_000 });

  const line = page.getByTestId('claude-added-cards');
  await expect(line).toContainText(/[Aa]dded to From Claude/, { timeout: 30_000 });
  const chip = line.getByTestId('added-card-chip');
  await expect(chip).toHaveCount(1);
  await expect(chip).toContainText('机会');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/05-added-line.png` });

  await chip.click();
  const explorer = page.getByTestId('explorer');
  await expect(explorer).toBeVisible();
  await expect(explorer.getByTestId('explorer-word-view')).toBeVisible();
  // The card is his — just added (before the sync lands) or "📚 You have this card" (after) — never "+ Add as card".
  const footer = page.getByTestId('explorer-word-card');
  await expect(footer).toContainText(/Added to From Claude|You have this card in From Claude/, { timeout: 15_000 });
  await expect(page.getByTestId('explorer-add-card')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/06-explorer-added-card.png` });
  await footer.getByRole('button', { name: '⚡ Study it today' }).click();
  await expect(footer.getByRole('button', { name: '⚡ Today ✓' })).toBeVisible({ timeout: 10_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/07-explorer-bumped.png` });

  // Several cards: one chip per word on the line.
  await page.getByTestId('explorer-close').click();
  await page.getByTestId('claude-chat-voice-type').click();
  await page.getByTestId('claude-chat-voice-text').fill('Make two cards: 机会 and 难得');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const second = page.getByTestId('claude-added-cards').nth(1);
  await expect(second.getByTestId('added-card-chip')).toHaveCount(2, { timeout: 30_000 });
  await expect(second).toContainText('难得');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/08-added-two.png` });
  await second.getByTestId('added-card-chip').nth(1).click();
  await expect(page.getByTestId('explorer-word-card')).toContainText(/Added to From Claude|You have this card in From Claude/, { timeout: 15_000 });
  await expect(page.getByTestId('explorer-add-card')).toHaveCount(0);
});

test('offline: the message waits in the outbox and is sent when the connection is back', async ({ page, request, context }) => {
  test.setTimeout(120_000);
  const { session_token } = await seedUser(request);
  await page.goto(`/chats?session_token=${session_token}`);
  await expect(page.getByTestId('chats-compose')).toBeVisible({ timeout: 30_000 });
  await page.goto('/chats/claude/new');
  await expect(page.getByTestId('claude-thread-empty')).toBeVisible();
  await context.setOffline(true);
  // Offline the box comes first (no ✏️ Type to tap).
  await page.getByTestId('claude-chat-voice-text').fill('你好吗？');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByTestId('claude-chat-queued')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('claude-chat-mine')).toContainText('你好吗？');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/04-offline-queued.png` });
  await context.setOffline(false);
  await expect(page.getByTestId('claude-chat-queued')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId('claude-chat-reply').last()).toContainText(FINAL, { timeout: 25_000 });
});
