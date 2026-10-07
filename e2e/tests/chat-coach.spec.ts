import { test, expect, type APIRequestContext, type Browser, type Locator, type Page } from '@playwright/test';

/**
 * Chat ↔ Coach (docs/CHAT.md "Chat ↔ Coach"), web:
 *   1. a photo with a Chinese caption is auto-checked (it used to be skipped) → the ✎ and a
 *      small "🎓 Open in Coach" chip under the bubble; the long-press menu has Open in Coach
 *      second; the chip opens the Coach with the check's result at once (no second Claude call)
 *      and the conversation is in the Coach history;
 *   2. Coach replies are written in the background: start a check, leave, come back → the
 *      answer is there; send a follow-up, leave, come back → the reply is there;
 *   3. "➕ Add new words (N)": the words of the sentence in none of my decks, nothing ticked,
 *      the ticked ones added to the chosen deck in one batch.
 * Claude is the worker's E2E stand-in (E2E_TEST_MODE: 2.5 s per answer) and the
 * /api/test/chat-auto-check seam (the real store + broadcast path with a canned check).
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const CAPTION = '我昨天去了商店买东西了';

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown; raw?: Buffer; type?: string } = {}) {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': opts.type ?? 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.raw ?? (opts.data === undefined ? undefined : JSON.stringify(opts.data)),
  });
  return { status: res.status(), body: (await res.json().catch(() => null)) as T };
}

async function seedUser(request: APIRequestContext, tag: string, name: string): Promise<SeededUser> {
  const email = `coachchat-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.body.user.id, email, token: r.body.session_token };
}

async function seedChat(request: APIRequestContext) {
  const tutor = await seedUser(request, 'tutor', '王明慧');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  const relId = rel.body.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });
  const conv = await api<{ id: string }>(request, `/api/relationships/${relId}/conversations`, { method: 'POST', token: tutor.token, data: {} });
  return { tutor, student, relId, convId: conv.body.id };
}

async function openAs(browser: Browser, user: SeededUser, path: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.setItem('chat-notify-nudge-dismissed', '1');
    } catch {
      /* ignore */
    }
  });
  // No word chips (no Claude call for them in E2E).
  await page.route('**/api/messages/*/words', (route) => route.fulfill({ json: { words: null, source: null, cached: false } }));
  await page.goto(`/?session_token=${user.token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await page.goto(path);
  return page;
}

async function touch(bubble: Locator, steps: Array<{ type: string; wait?: number }>) {
  const box = (await bubble.boundingBox())!;
  for (const s of steps) {
    await bubble.dispatchEvent(s.type, { clientX: box.x + 20, clientY: box.y + box.height / 2, pointerType: 'touch', pointerId: 3, isPrimary: true, bubbles: true });
    if (s.wait) await bubble.page().waitForTimeout(s.wait);
  }
}

/** PR screenshots (docs/pr-screenshots/chat-coach-integration) when SHOOT=1. */
async function shoot(page: Page, name: string) {
  if (!process.env.SHOOT) return;
  await page.waitForTimeout(500);
  await page.screenshot({ path: `../docs/pr-screenshots/chat-coach-integration/${name}.png` });
}

/** A tiny PNG (the server reads the magic bytes and the IHDR size). */
function png(): Buffer {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 10, 0, 0, 0, 10]).copy(b);
  return b;
}

test('a photo caption is auto-checked → Open in Coach shows the check at once and keeps it in the history', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const { student, relId, convId } = await seedChat(request);
  const sent = await api<{ id: string }>(request, `/api/conversations/${convId}/media?kind=image&caption=${encodeURIComponent(CAPTION)}`, {
    method: 'POST', token: student.token, raw: png(), type: 'image/png',
  });
  expect(sent.status).toBe(201);
  // The background check (E2E: the seam's canned answer through the real store + broadcast).
  const seeded = await api<{ outcome: string }>(request, '/api/test/chat-auto-check', { method: 'POST', data: { message_id: sent.body.id } });
  expect(seeded.body.outcome).toBe('checked');

  const page = await openAs(browser, student, `/connections/${relId}/chat/${convId}`);
  const mine = page.getByTestId('chat-message').filter({ hasText: CAPTION });
  await expect(mine.getByTestId('chat-saybetter-mark')).toBeVisible({ timeout: 20000 });
  const chip = mine.getByTestId('chat-open-in-coach');
  await expect(chip).toBeVisible();
  await shoot(page, 'web-01-photo-chip');

  // Long-press: How to say it better first, Open in Coach second.
  await touch(mine.locator('.chat-bubble'), [{ type: 'pointerdown', wait: 700 }, { type: 'pointerup' }]);
  const menu = page.getByTestId('message-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.msg-sheet-action').nth(0)).toHaveAttribute('data-tool', 'say_better');
  await expect(menu.locator('.msg-sheet-action').nth(1)).toHaveAttribute('data-tool', 'open_coach');
  await shoot(page, 'web-02-menu');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // The chip → the Coach, with the auto-check's result straight away (no Claude call: 201).
  const started = page.waitForResponse((r) => r.url().endsWith('/api/coach/conversations') && r.request().method() === 'POST');
  await chip.click();
  expect((await started).status()).toBe(201);
  await expect(page).toHaveURL(/\/coach\?c=/);
  await expect(page.getByText('Needs a little work')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.coach-corrected-hanzi')).toHaveText('我昨天去商店买东西了');
  await expect(page.getByText('One 了 at the end is enough here', { exact: false })).toBeVisible();
  await shoot(page, 'web-03-coach-from-chat');

  // In the Coach history; opening the same message again reopens it (200, reused).
  await page.getByRole('button', { name: '← Coach' }).click();
  await expect(page.locator('.coach-conv-item').filter({ hasText: CAPTION })).toHaveCount(1);
  const again = await api<{ reused?: boolean }>(request, '/api/coach/conversations', {
    method: 'POST', token: student.token, data: { text: CAPTION, action: 'check', background: true, chat_message_id: sent.body.id },
  });
  expect(again.status).toBe(200);
  expect(again.body.reused).toBe(true);
  await page.context().close();
});

test('a Coach reply keeps going when you leave: start, leave, come back; follow-up, leave, come back', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const user = await seedUser(request, 'solo', 'Jerome');
  const page = await openAs(browser, user, '/coach');
  await page.locator('.sentence-input-form textarea').fill('我们明天一起去公园吧');
  await page.locator('.sentence-input-form').getByTestId('coach-action-check').click();
  // The page moves to the conversation at once with the answer pending…
  await expect(page).toHaveURL(/\/coach\?c=/);
  await expect(page.getByTestId('coach-reply-pending')).toBeVisible();
  const convUrl = page.url();
  // …and I leave straight away.
  await page.goto('/decks');
  await page.waitForTimeout(800);
  await page.goto('/coach');
  const row = page.locator('.coach-conv-item').filter({ hasText: '我们明天一起去公园吧' });
  await expect(row).toBeVisible();
  // Thinking… in the list while it is still being written (the fake takes 2.5 s).
  if (await row.getByTestId('coach-conv-thinking').isVisible()) await shoot(page, 'web-04-list-thinking');
  await expect(row.getByTestId('coach-conv-thinking')).toHaveCount(0, { timeout: 20000 });
  await row.locator('.coach-conv-open').click();
  await expect(page.getByText('(E2E) Looks fine.')).toBeVisible({ timeout: 15000 });

  // A follow-up, then leave before the reply.
  await page.locator('.coach-followup-input').fill('Why 吧 here?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByTestId('coach-reply-pending')).toBeVisible();
  await shoot(page, 'web-05-thinking');
  await page.goto('/');
  await page.waitForTimeout(3500);
  await page.goto(convUrl.replace(/^https?:\/\/[^/]+/, ''));
  await expect(page.getByText("(E2E) The coach's answer to: Why 吧 here?")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('coach-reply-pending')).toHaveCount(0);
  await page.context().close();
});

test('Add new words: only words in no deck, nothing ticked, the ticked ones added in one batch', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const user = await seedUser(request, 'words', 'Jerome');
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: user.token, data: { name: 'HSK 2' } });
  await api(request, `/api/decks/${deck.body.id}/notes`, { method: 'POST', token: user.token, data: { hanzi: '我', pinyin: 'wǒ', english: 'I' } });

  const page = await openAs(browser, user, '/decks');
  // Let the first sync bring the deck and its note to the device.
  await expect(page.getByText('HSK 2').first()).toBeVisible({ timeout: 30000 });
  await page.goto(`/coach?text=${encodeURIComponent('我昨天去银行取钱了')}&action=explain`);
  await expect(page).toHaveURL(/\/coach\?c=/, { timeout: 15000 });
  // The E2E Explain: 我 (known) 昨天 去 银行 取钱 了 (a particle, never offered) → four new words.
  const chip = page.getByTestId('coach-quick-new-words');
  await expect(chip).toHaveText('➕ Add new words (4)', { timeout: 20000 });
  await expect(page.getByTestId('coach-quick-sentence-card')).toBeVisible();
  await page.getByTestId('coach-quick-actions').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 200));
  await shoot(page, 'web-06-quick-actions');
  await chip.click();
  const sheet = page.getByTestId('coach-new-words-sheet');
  await expect(sheet.getByTestId('coach-new-word-row')).toHaveCount(4);
  await expect(sheet.locator('input[type=checkbox]:checked')).toHaveCount(0);
  await expect(sheet.getByTestId('coach-new-words-add')).toBeDisabled();
  await sheet.getByRole('checkbox', { name: '银行' }).check();
  await sheet.getByRole('checkbox', { name: '取钱' }).check();
  await expect(sheet.getByTestId('coach-new-words-add')).toHaveText('➕ Add 2 words');
  await shoot(page, 'web-07-new-words-sheet');
  await sheet.getByTestId('coach-new-words-add').click();
  await expect(sheet.getByTestId('coach-new-words-done')).toContainText('Added 2 cards to HSK 2', { timeout: 20000 });
  await shoot(page, 'web-08-new-words-done');
  const d = await api<{ notes: Array<{ hanzi: string }> }>(request, `/api/decks/${deck.body.id}`, { token: user.token });
  expect(d.body.notes.map((n) => n.hanzi).sort()).toEqual(['我', '取钱', '银行'].sort());
  await sheet.getByTestId('coach-new-words-close').click();
  // The chip now offers only what is left.
  await expect(chip).toHaveText('➕ Add new words (2)', { timeout: 10000 });
  await page.context().close();
});
