import { test, expect, APIRequestContext, Browser, Page, Locator } from '@playwright/test';

/**
 * Chat listening mode on the web (docs/CHAT.md "Listening mode"): switched on
 * from the chat's ⋯ menu, a new Chinese message from the other person arrives
 * hidden; a tap plays it (the clip is requested), a long press reveals it
 * (no message menu), and it stays revealed after a reload. The inbox doesn't
 * spoil it either.
 */

test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined } });

const API = process.env.E2E_API_URL || 'http://localhost:8787';

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
  const email = `listen-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
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

/** A tiny valid MP3 frame, so the browser can "play" it. */
const MP3 = Buffer.from('//uQZAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID///////////////////////////////////////////8AAAA8TEFNRTMuOTlyAc0AAAAAAAAAABSAJAKjQgAAgAAAAnGMHkkIAAAAAAAAAAAAAAAAAAAA', 'base64');

async function openAs(browser: Browser, user: SeededUser, path: string, audioRequests: string[]): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.setItem('chat-notify-nudge-dismissed', '1');
    } catch {
      /* ignore */
    }
  });
  await page.route('**/api/messages/*/words', (route) => route.fulfill({ json: { words: null, source: null, cached: false } }));
  // The read-aloud clip (no TTS key locally): count the requests, answer with a short MP3.
  await page.route('**/api/messages/*/audio', (route) => {
    const id = new URL(route.request().url()).pathname.split('/')[3];
    audioRequests.push(id);
    return route.fulfill({ body: MP3, headers: { 'Content-Type': 'audio/mpeg', 'X-Clip-Id': `${id}-e2e` } });
  });
  await page.goto(`/?session_token=${user.token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await page.goto(path);
  return page;
}

async function touch(bubble: Locator, steps: Array<{ type: string; wait?: number }>) {
  const box = (await bubble.boundingBox())!;
  const x0 = box.x + 20;
  const y0 = box.y + box.height / 2;
  // The same element throughout: a reveal changes the bubble's classes mid-press.
  const el = (await bubble.elementHandle())!;
  for (const s of steps) {
    await el.dispatchEvent(s.type, { clientX: x0, clientY: y0, pointerType: 'touch', pointerId: 3, isPrimary: true, bubbles: true });
    if (s.wait) await bubble.page().waitForTimeout(s.wait);
  }
}

test('listening mode: a new message is hidden, tap plays, long-press reveals, reload keeps it revealed', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { tutor, student, relId, convId } = await seedChat(request);
  await say(request, tutor, convId, '你好！');
  const audioRequests: string[] = [];
  const page = await openAs(browser, student, `/connections/${relId}/chat/${convId}`, audioRequests);
  await expect(page.getByTestId('chat-message').filter({ hasText: '你好！' })).toBeVisible({ timeout: 20000 });

  // ⋯ → 🎧 Listening mode.
  await page.getByRole('button', { name: 'Conversation menu' }).click();
  const toggle = page.getByTestId('chat-listening-toggle');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(page.getByTestId('chat-listening-status')).toContainText('Listening mode');
  // History stays visible.
  await expect(page.getByTestId('chat-message').filter({ hasText: '你好！' })).toBeVisible();
  // Stored on the server too (notification previews read it).
  await expect.poll(async () => (await api<{ conversations: Array<{ conversation_id: string; on: boolean }> }>(request, '/api/me/chat-listening', { token: student.token })).body.conversations.find((c) => c.conversation_id === convId)?.on).toBe(true);

  // A new message from the tutor arrives hidden.
  const sent = await say(request, tutor, convId, '我们明天去商店吧！');
  const hidden = page.getByTestId('chat-listening-bubble');
  await expect(hidden).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('我们明天去商店吧！')).toHaveCount(0);
  await expect(hidden).toContainText('Tap to listen · hold to reveal');

  // Tap → the clip is requested and plays.
  const bubble = page.locator('.chat-bubble.listening');
  await bubble.click();
  await expect.poll(() => audioRequests.includes(sent.id)).toBe(true);
  await expect(page.getByText('我们明天去商店吧！')).toHaveCount(0);

  // Long-press → revealed, and no message menu.
  await touch(bubble, [{ type: 'pointerdown', wait: 750 }, { type: 'pointerup' }]);
  await expect(page.getByText('我们明天去商店吧！')).toBeVisible();
  await expect(page.getByTestId('message-menu')).toHaveCount(0);
  await expect(page.getByTestId('chat-listening-bubble')).toHaveCount(0);

  // Once revealed, a long-press opens the menu as usual.
  const revealed = page.getByTestId('chat-message').filter({ hasText: '我们明天去商店吧！' }).locator('.chat-bubble');
  await page.waitForTimeout(300);
  await touch(revealed, [{ type: 'pointerdown', wait: 750 }, { type: 'pointerup' }]);
  await expect(page.getByTestId('message-menu')).toBeVisible();
  await page.keyboard.press('Escape');

  // Reload: still revealed (stored on this device).
  await page.reload();
  await expect(page.getByText('我们明天去商店吧！')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('chat-listening-bubble')).toHaveCount(0);

  // Another message hides; the inbox shows "🎧 New message" for it.
  await say(request, tutor, convId, '你几点有空？');
  await expect(page.getByTestId('chat-listening-bubble')).toHaveCount(1, { timeout: 20000 });
  await page.goto('/chats');
  await expect(page.getByTestId('chats-row').first()).toContainText('🎧 New message', { timeout: 20000 });
  await expect(page.getByText('你几点有空？')).toHaveCount(0);

  await page.context().close();
});
