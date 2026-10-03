import { test, expect, APIRequestContext, Browser, Page, Locator } from '@playwright/test';

/**
 * Chat round 2 on the web (docs/CHAT.md "Round 2"): Signal-like bubbles with no
 * buttons on them; right-click / hover ⋯ (desktop) and long-press (touch) open
 * the message menu with the reaction bar; Explain / Save as flashcard; swipe
 * right to reply; hold the mic to record (slide left cancels, release sends).
 */

test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  },
});

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

async function say(request: APIRequestContext, user: SeededUser, convId: string, content: string) {
  const r = await api<{ id: string }>(request, `/api/conversations/${convId}/messages`, { method: 'POST', token: user.token, data: { content } });
  expect(r.status).toBe(201);
  return r.body;
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

test('bubbles carry no buttons; right-click opens the menu at the pointer; Reply, React, Copy', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { tutor, student, relId, convId } = await seedChat(request);
  await say(request, student, convId, '老师，我明天可以早一点来吗？');
  await say(request, student, convId, '大概九点');
  const page = await openAs(browser, tutor, `/connections/${relId}/chat/${convId}`, { width: 1280, height: 860 });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const first = page.getByTestId('chat-message').filter({ hasText: '老师，我明天' });
  await expect(first).toBeVisible({ timeout: 20000 });

  // Signal-like: one group, the time only on its last bubble; no 拼 / EN / ↩ buttons.
  await expect(first).toHaveClass(/group-first/);
  await expect(first.getByTestId('chat-bubble-meta')).toHaveCount(0);
  await expect(page.getByTestId('chat-message').filter({ hasText: '大概九点' }).getByTestId('chat-bubble-meta')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show pinyin' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reply', exact: true })).toHaveCount(0);
  // Tap shows that bubble's time.
  await first.locator('.chat-bubble').click();
  await expect(first.getByTestId('chat-bubble-meta')).toBeVisible();

  // Right-click → popover with the reaction bar and the tutor's tools.
  await first.locator('.chat-bubble').click({ button: 'right' });
  const menu = page.getByTestId('message-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId('message-menu-reactions')).toBeVisible();
  for (const tool of ['reply', 'copy', 'translate', 'pinyin', 'explain', 'save_card', 'select_cards', 'correct', 'pin', 'select']) {
    await expect(menu.locator(`[data-tool="${tool}"]`)).toBeVisible();
  }
  await expect(menu.locator('[data-tool="edit"]')).toHaveCount(0);
  await menu.locator('[data-tool="reply"]').click();
  await expect(page.locator('.reply-bar')).toContainText('Replying to Jerome');
  await page.getByRole('button', { name: 'Cancel reply' }).click();

  // React from the bar.
  await first.locator('.chat-bubble').click({ button: 'right' });
  await menu.getByRole('button', { name: 'React 👍' }).click();
  await expect(first.locator('.reaction-badge')).toContainText('👍', { timeout: 10000 });

  // Copy.
  await first.locator('.chat-bubble').click({ button: 'right' });
  await menu.locator('[data-tool="copy"]').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('老师，我明天可以早一点来吗？');

  await page.context().close();
});

test('long-press opens the sheet; Explain and Save as flashcard; swipe right replies', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { tutor, student, relId, convId } = await seedChat(request);
  await say(request, tutor, convId, '我们明天去商店吧！');
  const page = await openAs(browser, student, `/connections/${relId}/chat/${convId}`);
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
  const bubble = msg.locator('.chat-bubble');

  // Long-press (touch) → the bottom sheet.
  await touch(bubble, [{ type: 'pointerdown', wait: 700 }, { type: 'pointerup' }]);
  const menu = page.getByTestId('message-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-tool="correct"]')).toHaveCount(0);
  await menu.locator('[data-tool="explain"]').click();
  const explain = page.getByTestId('chat-explain-sheet');
  await expect(explain).toContainText("Let's go to the shop tomorrow!");
  await expect(explain.getByTestId('sentence-word-breakdown')).toContainText('shāngdiàn');
  await explain.getByRole('button', { name: '🃏 Save as flashcard' }).click();
  // The whole sentence as one card, fun_facts glossing every word.
  await expect(page.getByText('Save to deck:')).toBeVisible();
  await expect(page.getByText('wǒmen míngtiān qù shāngdiàn ba')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Save to deck:')).toHaveCount(0);

  // Swipe right → reply.
  await page.waitForTimeout(300);
  await touch(bubble, [{ type: 'pointerdown' }, { type: 'pointermove', dx: 20 }, { type: 'pointermove', dx: 60 }, { type: 'pointermove', dx: 80 }, { type: 'pointerup', dx: 80 }]);
  await expect(page.locator('.reply-bar')).toContainText('Replying to 王明慧');

  await page.context().close();
});

test('hold the mic to record: a quick tap explains, slide left cancels, release sends', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { tutor, student, relId, convId } = await seedChat(request);
  await say(request, tutor, convId, '说一句话给我听听');
  const page = await openAs(browser, student, `/connections/${relId}/chat/${convId}`);
  await expect(page.getByText('说一句话给我听听')).toBeVisible({ timeout: 20000 });
  const mic = page.getByTestId('chat-mic-btn');
  const box = (await mic.boundingBox())!;
  const at = (dx = 0, dy = 0) => ({ clientX: box.x + box.width / 2 + dx, clientY: box.y + box.height / 2 + dy, pointerType: 'touch', pointerId: 9, isPrimary: true, bubbles: true });

  // A quick tap: nothing recorded, a hint.
  await mic.dispatchEvent('pointerdown', at());
  await mic.dispatchEvent('pointerup', at());
  await expect(page.getByText('Hold the mic to record, release to send.')).toBeVisible();
  await expect(page.getByTestId('voice-composer')).toHaveCount(0, { timeout: 5000 });

  // Hold, slide left past the threshold → cancelled.
  await mic.dispatchEvent('pointerdown', at());
  await expect(page.getByTestId('voice-composer')).toHaveAttribute('data-mode', 'held');
  await expect(page.getByText('‹ Slide to cancel')).toBeVisible();
  await page.waitForTimeout(800);
  await mic.dispatchEvent('pointermove', at(-60));
  await mic.dispatchEvent('pointermove', at(-120));
  await expect(page.getByTestId('voice-composer')).toHaveCount(0, { timeout: 5000 });
  await expect(page.getByTestId('chat-voice')).toHaveCount(0);

  // Hold ~1.5 s and release → a voice message goes out.
  await mic.dispatchEvent('pointerdown', at());
  await expect(page.getByTestId('voice-composer')).toBeVisible();
  await expect(page.locator('.chat-rec-time')).not.toHaveText('Starting…', { timeout: 5000 });
  await page.waitForTimeout(1500);
  await mic.dispatchEvent('pointerup', at());
  await expect(page.getByTestId('chat-voice')).toHaveCount(1, { timeout: 10000 });
  await expect(page.getByTestId('chat-voice-speed')).toHaveText('1×');
  await page.getByTestId('chat-voice-speed').click();
  await expect(page.getByTestId('chat-voice-speed')).toHaveText('1.5×');

  // Hold and slide up → locked: the recorder stays with its own Send.
  await mic.dispatchEvent('pointerdown', at());
  await page.waitForTimeout(800);
  await mic.dispatchEvent('pointermove', at(0, -90));
  await expect(page.getByTestId('voice-composer')).toHaveAttribute('data-mode', 'locked');
  await page.getByRole('button', { name: 'Discard recording' }).click();
  await expect(page.getByTestId('voice-composer')).toHaveCount(0);

  await page.context().close();
});
