import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * "💬 Ask Claude" on the Sentence Coach (docs/CHAT.md "Ask Claude chat"): the button opens a plain
 * chat; the question gets a reply written in the background (E2E stand-in: a Chinese answer about
 * 成都 food); Claude's Chinese is word chips with ▶ / 拼 / EN / 🎤 under it, a tapped word opens the
 * language explorer and counts as a word to recap; leaving and coming back keeps the chat; ⋯ → Make
 * flashcards proposes the tapped word first; 🎤 Read it back marks Claude's message in place (a fake
 * microphone; the take's upload is mocked).
 *
 * COACH_ASK_SHOTS=<dir> also saves phone-size screenshots there (PR screenshots).
 */
const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SHOTS = process.env.COACH_ASK_SHOTS;

test.use({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

async function seedUser(request: APIRequestContext) {
  const email = `coach-ask-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const res = await request.post(`${API}/api/test/auth`, { data: { email, name: 'Jerome' } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { session_token: string };
}

test('Ask Claude: a plain chat in simple Chinese, word chips into the explorer, flashcards from the tapped words', async ({ page, request }) => {
  test.setTimeout(120_000);
  const { session_token } = await seedUser(request);
  // No live key: the take is uploaded; the recogniser "heard" 活过 for 火锅 and stopped before the end.
  await page.route('**/api/transcribe/live', (route) => route.fulfill({ json: { provider: 'upload' } }));
  await page.route('**/api/transcribe', (route) => route.fulfill({ json: { text: '成都的菜很有名，特别是活过。火锅又麻又辣，可是很好吃。', language: 'zh', provider: 'test' } }));
  await page.goto(`/coach?session_token=${session_token}`);
  await expect(page.getByTestId('coach-ask-entry')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-coach-entry.png` });
  await page.getByTestId('coach-ask-entry').click();
  await expect(page).toHaveURL(/\/coach\/chat\/new$/);
  await expect(page.getByTestId('claude-chat-empty')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-new-chat.png` });

  await page.getByTestId('claude-chat-voice-type').click();
  await page.getByTestId('claude-chat-voice-text').fill('成都有什么好吃的？');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL(/\/coach\/chat\/(?!new)[^/]+$/, { timeout: 15000 });
  const reply = page.getByTestId('claude-chat-reply').first();
  await expect(reply).toContainText('火锅', { timeout: 20000 });
  await expect(reply.getByTestId('claude-chat-read-back')).toBeVisible();

  await reply.getByTestId('claude-chat-pinyin').click();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-chat-pinyin.png` });
  await reply.getByTestId('claude-chat-pinyin').click();
  // EN under the bubble.
  await reply.getByTestId('claude-chat-translate').click();
  await expect(reply.getByTestId('chat-translation')).toContainText('hot pot');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/04-chat-translation.png` });
  await reply.getByTestId('claude-chat-translate').click();

  // A word → the language explorer.
  await reply.locator('.chat-word', { hasText: '火锅' }).first().click();
  await expect(page.getByTestId('explorer')).toBeVisible();
  if (SHOTS) { await page.waitForTimeout(800); await page.screenshot({ path: `${SHOTS}/05-explorer.png` }); }
  await page.getByTestId('explorer-close').click();

  // 🎤 Read it back: Claude's message marked in place, one line under it.
  const mic = reply.getByTestId('claude-chat-read-back');
  await mic.click();
  await expect(mic).toHaveAttribute('aria-label', 'Stop — check my reading');
  await page.waitForTimeout(1200);
  await mic.click();
  await expect(reply.getByTestId('reader-read-aloud-line')).toContainText('to check', { timeout: 20_000 });
  await expect(reply.locator('[data-mark="close"]').first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/06-read-back.png` });

  // Leaving and coming back keeps the chat (the Coach lists it with 💬).
  const url = page.url();
  await page.goto('/coach');
  await expect(page.getByTestId('coach-conv-ask').first()).toContainText('成都有什么好吃的');
  await page.goto(url.replace(/^https?:\/\/[^/]+/, ''));
  await expect(page.getByTestId('claude-chat-reply').first()).toContainText('火锅');

  // ⋯ → the recap row (coming soon) counts the tapped word; Make flashcards proposes it, ticked.
  await page.getByTestId('claude-chat-more').click();
  // 火锅 tapped (and said wrong), plus the words missed at the end of the take.
  await expect(page.getByTestId('claude-chat-recap')).toContainText('words to recap');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/07-menu.png` });
  await page.getByTestId('claude-chat-make-cards').click();
  const item = page.getByTestId('chat-card-item').first();
  await expect(item).toContainText('火锅', { timeout: 20000 });
  await expect(item.locator('input[type="checkbox"]')).toBeChecked();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/08-make-flashcards.png` });
});
