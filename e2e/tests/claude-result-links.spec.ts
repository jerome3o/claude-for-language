import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { skipFirstCardExplainer } from './fixtures/explainer';

test.beforeEach(async ({ context }) => skipFirstCardExplainer(context));

/**
 * The lines under a Claude reply open what they made (docs/CHAT.md "Tool lines you can tap"; Jerome:
 * "I kind of expect to be able to click this bottom element to go to the lesson and then navigate
 * back later"). Against the real worker and its E2E stand-in model (services/claude-agent/fake.ts: a
 * question asking for a "mini lesson" makes FAKE_LESSON with create_custom_lesson):
 *
 * study a card → Ask Claude → "make me a mini lesson" → "🎓 Mini lesson made: 治理 vs 这里：听力辨音 ·
 * Start ›" is a button → the player opens on that lesson (`?from=claude`) → ✕ → back on the SAME study
 * card with the sheet open on the same thread (the line still there) → the same thread as a page in the
 * Chats tab → the line → the player → back → the same thread page.
 *
 * RESULT_LINK_SHOTS=<dir> also saves screenshots there (PR screenshots).
 */
const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SHOTS = process.env.RESULT_LINK_SHOTS;
const TITLE = '治理 vs 这里：听力辨音';

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

async function typeQuestion(sheet: Locator, text: string) {
  const type = sheet.getByTestId('claude-chat-voice-type');
  if (await type.isVisible().catch(() => false)) await type.click();
  await sheet.getByTestId('claude-chat-voice-text').fill(text);
  await sheet.getByTestId('claude-chat-voice-submit').click();
}

async function studyToBack(page: Page, token: string, deckId: string) {
  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('辨音练习').first()).toBeVisible({ timeout: 30_000 });
  await page.goto(`/study?deck=${deckId}&autostart=true`);
  const skip = page.getByTestId('skip-recording');
  await expect(skip).toBeVisible({ timeout: 30_000 });
  const gotIt = page.getByRole('button', { name: 'Got it' });
  await page.waitForTimeout(500);
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await skip.click();
  await expect(page.getByTestId('study-card-back')).toBeVisible();
}

test('a "Mini lesson made" line opens the lesson, and back returns to the same card sheet / thread', async ({ page, request }) => {
  test.setTimeout(180_000);
  const email = `result-links-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: '辨音练习' } });
  await api(request, `/api/decks/${deck.id}/notes`, { method: 'POST', token, data: { hanzi: '这里', pinyin: 'zhèlǐ', english: 'here', fun_facts: '这 (zhè) this + 里 (lǐ) inside → here.' } });
  await studyToBack(page, token, deck.id);
  const studyUrl = page.url();

  // Ask Claude on the card → a mini lesson.
  await page.getByRole('button', { name: 'Ask Claude' }).click();
  const sheet = page.getByTestId('ask-claude-sheet');
  await expect(sheet).toBeVisible();
  await typeQuestion(sheet, 'I struggle to tell 治理 and 这里 apart — make me a mini lesson.');
  const line = sheet.getByTestId('card-claude-tool-lesson');
  await expect(line).toContainText(`🎓 Mini lesson made: ${TITLE}`, { timeout: 30_000 });
  await expect(line).not.toContainText('Mini Lessons page');
  await expect(line).toContainText('Start ›');
  await expect(line).toHaveAttribute('aria-label', `Start the mini lesson ${TITLE}`);
  const box = (await line.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  if (SHOTS) {
    await line.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/web-01-sheet-line.png` });
  }

  // Tap → the player on that lesson.
  await line.click();
  await expect(page).toHaveURL(/\/lessons\/[^/]+\/play\?from=claude$/);
  const lessonUrl = page.url();
  await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 30_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-02-lesson.png` });

  // ✕ → back on the same study card, its sheet open on the same thread.
  await page.getByRole('button', { name: 'Close lesson' }).click();
  await expect(page).toHaveURL(studyUrl);
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await expect(sheet.getByTestId('card-claude-tool-lesson')).toContainText(TITLE, { timeout: 20_000 });
  await expect(page.getByTestId('study-card-back')).toBeAttached();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-03-back-in-sheet.png` });
  // Closed by hand: a later return to Study doesn't reopen it.
  await sheet.getByTestId('claude-thread-close').click();
  await expect(sheet).toBeHidden();

  // The same thread as a page (the Chats tab): the line → the player → back → the same thread.
  await page.goto('/chats');
  const row = page.getByTestId('chats-claude-row').first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page).toHaveURL(/\/chats\/claude\/[^/]+$/);
  const threadUrl = page.url();
  const pageLine = page.getByTestId('claude-tool-lesson').or(page.getByTestId('card-claude-tool-lesson'));
  await expect(pageLine.first()).toContainText(TITLE, { timeout: 20_000 });
  await pageLine.first().click();
  await expect(page).toHaveURL(lessonUrl);
  await page.goBack();
  await expect(page).toHaveURL(threadUrl);
  await expect(pageLine.first()).toBeVisible({ timeout: 20_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-04-back-in-thread.png` });
});
