import { test, expect, type APIRequestContext, type Browser, type Locator, type Page } from '@playwright/test';

/**
 * "Check my Chinese automatically" (docs/CHAT.md "Auto-check"), web: the
 * student sends 我昨天去了商店买东西了 → the background check lands (Claude is
 * replaced by the E2E seam POST /api/test/chat-auto-check, which runs the real
 * store + message_updated path) → a calm ✎ appears on the bubble → long-press →
 * "How to say it better" is the FIRST item → the sheet shows the fix → add it as
 * a flashcard. The tutor never sees the mark.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}) {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  return { status: res.status(), body: (await res.json().catch(() => null)) as T };
}

async function seedUser(request: APIRequestContext, tag: string, name: string): Promise<SeededUser> {
  const email = `chatr2-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
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

async function openAs(browser: Browser, user: SeededUser, path: string, viewport = { width: 412, height: 915 }): Promise<Page> {
  const context = await browser.newContext({ viewport, permissions: ['microphone'] });
  const page = await context.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.setItem('chat-notify-nudge-dismissed', '1');
    } catch {
      /* ignore */
    }
  });
  // No word chips (keeps the bubbles plain text and avoids a Claude call).
  await page.route('**/api/messages/*/words', (route) => route.fulfill({ json: { words: null, source: null, cached: false } }));
  await page.goto(`/?session_token=${user.token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await page.goto(path);
  return page;
}

/** A touch long-press / swipe through pointer events (what the bubble listens to). */
async function touch(bubble: Locator, steps: Array<{ type: string; dx?: number; wait?: number }>) {
  const box = (await bubble.boundingBox())!;
  const x0 = box.x + 20;
  const y0 = box.y + box.height / 2;
  for (const s of steps) {
    await bubble.dispatchEvent(s.type, { clientX: x0 + (s.dx ?? 0), clientY: y0, pointerType: 'touch', pointerId: 3, isPrimary: true, bubbles: true });
    if (s.wait) await bubble.page().waitForTimeout(s.wait);
  }
}


/** PR screenshots (docs/pr-screenshots/chat-auto-check) when SHOOT=1. */
async function shoot(page: Page, name: string) {
  if (!process.env.SHOOT) return;
  await page.waitForTimeout(500); // sheets slide / fade in
  await page.screenshot({ path: `../docs/pr-screenshots/chat-auto-check/${name}.png` });
}

test('a student message gets the ✎, the menu starts with How to say it better, the sheet adds a card', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const { tutor, student, relId, convId } = await seedChat(request);
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: student.token, data: { name: '聊天里学的' } });
  expect(deck.status).toBe(201);

  const page = await openAs(browser, student, `/connections/${relId}/chat/${convId}`);
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.click();
  await box.fill('我昨天去了商店买东西了');
  await box.press('Enter');
  const mine = page.getByTestId('chat-message').filter({ hasText: '我昨天去了商店买东西了' });
  await expect(mine).toBeVisible();
  await expect(mine.getByTestId('chat-receipt')).toBeVisible({ timeout: 15000 });
  await expect(mine.getByTestId('chat-saybetter-mark')).toHaveCount(0);

  // The background check lands.
  const list = await api<{ messages: Array<{ id: string; content: string }> }>(request, `/api/conversations/${convId}/messages`, { token: student.token });
  const sent = list.body.messages.find((m) => m.content === '我昨天去了商店买东西了')!;
  const seeded = await api<{ outcome: string }>(request, '/api/test/chat-auto-check', { method: 'POST', data: { message_id: sent.id } });
  expect(seeded.body.outcome).toBe('checked');

  const mark = mine.getByTestId('chat-saybetter-mark');
  await expect(mark).toBeVisible({ timeout: 20000 });
  await expect(mark).toHaveAttribute('aria-label', 'Could be better — hold to see');
  await shoot(page, 'web-01-indicator');

  // Long-press → the first item is "How to say it better".
  await touch(mine.locator('.chat-bubble'), [{ type: 'pointerdown', wait: 700 }, { type: 'pointerup' }]);
  const menu = page.getByTestId('message-menu');
  await expect(menu).toBeVisible();
  const first = menu.locator('.msg-sheet-action').first();
  await expect(first).toHaveAttribute('data-tool', 'say_better');
  await expect(first).toContainText('How to say it better');
  await expect(menu.locator('[data-tool="check"]')).toHaveCount(0);
  await shoot(page, 'web-02-menu');
  await first.click();

  // The sheet: what I wrote marked, the fix, each mistake, the more natural way.
  const sheet = page.getByTestId('chat-saybetter-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('chat-saybetter-diff').locator('del')).toContainText('了');
  await expect(sheet.getByTestId('chat-saybetter-corrected')).toHaveText('我昨天去商店买东西了');
  await expect(sheet).toContainText('wǒ zuótiān qù shāngdiàn mǎi dōngxi le');
  await expect(sheet.getByTestId('chat-saybetter-mistakes')).toContainText('One 了 at the end is enough here');
  await expect(sheet).toContainText('我昨天去商店买了点东西');
  await shoot(page, 'web-03-sheet');

  // + Add as flashcard → the add-card sheet with the corrected sentence → saved to the deck.
  await sheet.getByTestId('chat-saybetter-add').click();
  await expect(page.getByText('Save to deck:')).toBeVisible();
  await expect(page.locator('.rp-modal-hanzi')).toHaveText('我昨天去商店买东西了。');
  await shoot(page, 'web-04-add-card');
  await page.getByRole('button', { name: '聊天里学的' }).click();
  await page.getByRole('button', { name: 'Add to deck' }).click();
  await expect(page.getByRole('button', { name: '✓ Added' })).toBeVisible({ timeout: 15000 });
  await expect.poll(async () => {
    const d = await api<{ notes: Array<{ hanzi: string }> }>(request, `/api/decks/${deck.body.id}`, { token: student.token });
    return (d.body.notes ?? []).map((n) => n.hanzi);
  }, { timeout: 15000 }).toContain('我昨天去商店买东西了。');
  await page.context().close();

  // The tutor sees the message without any mark.
  const tutorPage = await openAs(browser, tutor, `/connections/${relId}/chat/${convId}`);
  const theirs = tutorPage.getByTestId('chat-message').filter({ hasText: '我昨天去了商店买东西了' });
  await expect(theirs).toBeVisible({ timeout: 20000 });
  await expect(theirs.getByTestId('chat-saybetter-mark')).toHaveCount(0);
  await tutorPage.context().close();
});
