import { test, expect, APIRequestContext, Browser, Page, Locator } from '@playwright/test';

/**
 * "Open ›: one tap to what just happened" (docs/STUDY_SESSION.md): a toast says what happened AND takes
 * him there — "✓ Added to From chats · Change · Open ›" opens the new card's hub, and back returns to the
 * chat; the tutor's "📚 You set Jerome's new cards …" chat line opens the student page at the Daily new
 * cards row. Hermetic: the breakdown is mocked, the budget is set through the API.
 *
 * TOAST_OPEN_SHOTS=<dir> also saves phone-size screenshots there (PR screenshots).
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SHOTS = process.env.TOAST_OPEN_SHOTS;

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST' | 'PUT'; token?: string; data?: unknown } = {}) {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  return { status: res.status(), body: (await res.json().catch(() => null)) as T };
}

async function seedUser(request: APIRequestContext, tag: string, name: string): Promise<SeededUser> {
  const email = `toastopen-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
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

test('"✓ Added to From chats · Open ›" opens the new card, and back returns to the chat', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { tutor, student, relId, convId } = await seedChat(request);
  const sent = await api<{ id: string }>(request, `/api/conversations/${convId}/messages`, { method: 'POST', token: tutor.token, data: { content: '我们明天去商店吧！' } });
  expect(sent.status).toBe(201);
  const chatPath = `/connections/${relId}/chat/${convId}`;
  const page = await openAs(browser, student, chatPath);
  await page.route('**/api/sentences/explain-text', (route) =>
    route.fulfill({
      json: {
        explanation: {
          words: [
            { hanzi: '我们', pinyin: 'wǒmen', gloss: 'we' },
            { hanzi: '明天', pinyin: 'míngtiān', gloss: 'tomorrow' },
            { hanzi: '去', pinyin: 'qù', gloss: 'go' },
            { hanzi: '商店', pinyin: 'shāngdiàn', gloss: 'shop' },
            { hanzi: '吧', pinyin: 'ba', gloss: 'suggestion particle' },
          ],
          construction: '吧 at the end turns it into a suggestion.',
          translation: "Let's go to the shop tomorrow!",
        },
      },
    }),
  );
  const msg = page.getByTestId('chat-message').filter({ hasText: '我们明天去商店吧' });
  await expect(msg).toBeVisible({ timeout: 20000 });
  await touch(msg.locator('.chat-bubble'), [{ type: 'pointerdown', wait: 700 }, { type: 'pointerup' }]);
  await page.getByTestId('message-menu').locator('[data-tool="explain"]').click();
  await page.getByTestId('chat-explain-sheet').getByRole('button', { name: '🃏 Save as flashcard' }).click();

  const line = page.getByTestId('added-to-deck');
  await expect(line).toContainText('Added to From chats', { timeout: 15000 });
  const open = line.getByTestId('toast-open');
  await expect(open).toHaveText(/Open\s*›/);
  await expect(open).toHaveAttribute('aria-label', /Open the card 我们明天去商店吧/);
  const box = (await open.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-01-added-open.png` });

  await open.click();
  await expect(page).toHaveURL(/\/cards\/[^/?#]+$/, { timeout: 15000 });
  await expect(page.getByText('我们明天去商店吧').first()).toBeVisible({ timeout: 20000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-02-card-hub.png` });

  // Back: the chat he was in.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${chatPath}$`));
  await expect(page.getByTestId('chat-message').filter({ hasText: '我们明天去商店吧' })).toBeVisible({ timeout: 20000 });
  await page.context().close();
});

test('the tutor\'s "You set Jerome\'s new cards" line opens the Daily new cards row', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { tutor, relId, convId } = await seedChat(request);
  const set = await api(request, `/api/relationships/${relId}/student-study-budget`, { method: 'PUT', token: tutor.token, data: { new_cards_per_day: 5, secondary_cards_per_day: 10 } });
  expect(set.status).toBe(200);
  const chatPath = `/connections/${relId}/chat/${convId}`;
  const page = await openAs(browser, tutor, chatPath);
  const row = page.getByTestId('chat-system-message').filter({ hasText: "You set Jerome's new cards to 5 a day" });
  await expect(row).toBeVisible({ timeout: 20000 });
  const action = row.getByTestId('chat-system-action');
  await expect(action).toHaveText('See their daily cards');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-03-budget-line.png` });
  await action.click();
  await expect(page).toHaveURL(new RegExp(`/connections/${relId}#long-term$`), { timeout: 15000 });
  await expect(page.getByTestId('daily-budget-row')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('daily-budget-row')).toBeInViewport();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-04-daily-budget.png` });
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${chatPath}$`));
  await page.context().close();
});
