import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * Live chat & rich messages on the web (docs/CHAT.md PR 2): optimistic sends
 * through the outbox, live delivery + typing + "Seen" over the ChatHub socket,
 * edit / delete, photos, search, pins and the "New messages" divider.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; token?: string; data?: unknown } = {},
): Promise<{ status: number; body: T }> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  return { status: res.status(), body: (await res.json().catch(() => null)) as T };
}

async function seedUser(request: APIRequestContext, tag: string, name: string): Promise<SeededUser> {
  const email = `chatlive-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.body.user.id, email, token: r.body.session_token };
}

async function seedChat(request: APIRequestContext) {
  const tutor = await seedUser(request, 'tutor', '王明慧');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST',
    token: tutor.token,
    data: { recipient_email: student.email, role: 'tutor' },
  });
  const relId = rel.body.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });
  const conv = await api<{ id: string }>(request, `/api/relationships/${relId}/conversations`, { method: 'POST', token: tutor.token, data: {} });
  return { tutor, student, relId, convId: conv.body.id };
}

async function say(request: APIRequestContext, user: SeededUser, convId: string, content: string) {
  const r = await api<{ id: string; created_at: string }>(request, `/api/conversations/${convId}/messages`, {
    method: 'POST',
    token: user.token,
    data: { content },
  });
  expect(r.status).toBe(201);
  return r.body;
}

async function openAs(browser: Browser, user: SeededUser, path: string, viewport = { width: 412, height: 915 }): Promise<Page> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.addInitScript(() => {
    if ('Notification' in window) Object.defineProperty(Notification, 'permission', { get: () => 'default' });
    try {
      localStorage.setItem('chat-notify-nudge-dismissed', '1');
    } catch {
      /* ignore */
    }
  });
  await page.goto(`/?session_token=${user.token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await page.goto(path);
  return page;
}

/** A small real PNG (a coloured square) for the file input. */
async function makePng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 80;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#f97316';
    ctx.fillRect(0, 0, 120, 80);
    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(20, 20, 40, 40);
    return c.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

test('a message goes out at once, arrives live with typing, and comes back Seen', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { tutor, student, relId, convId } = await seedChat(request);
  await say(request, tutor, convId, '你好！今天有空吗？');
  const chatPath = `/connections/${relId}/chat/${convId}`;

  const studentPage = await openAs(browser, student, chatPath);
  const tutorPage = await openAs(browser, tutor, chatPath, { width: 1280, height: 860 });
  await expect(studentPage.getByText('你好！今天有空吗？')).toBeVisible({ timeout: 20000 });
  await expect(tutorPage.getByText('你好！今天有空吗？')).toBeVisible({ timeout: 20000 });
  // Both sockets connected (the hello frame) before anything is typed.
  await studentPage.waitForTimeout(1500);

  // Typing → the other side sees it.
  const box = studentPage.getByRole('textbox', { name: 'Message' });
  await box.click();
  await box.pressSequentially('我有空', { delay: 60 });
  await expect(tutorPage.getByTestId('chat-typing')).toContainText('Jerome is typing', { timeout: 8000 });

  // Send: the bubble appears immediately, then is confirmed by the server.
  await box.fill('我有空，下午三点可以吗？');
  await box.press('Enter');
  const mine = studentPage.getByTestId('chat-message').filter({ hasText: '我有空，下午三点可以吗？' });
  await expect(mine).toBeVisible({ timeout: 1000 });
  await expect(mine.getByTestId('chat-send-pending')).toHaveCount(0, { timeout: 10000 });
  await expect(mine.getByTestId('chat-receipt')).toHaveAttribute('data-kind', 'sent');

  // Live: the tutor gets it well before a 3 s poll would, without a reload; typing clears.
  await expect(tutorPage.getByText('我有空，下午三点可以吗？')).toBeVisible({ timeout: 2500 });
  await expect(tutorPage.getByTestId('chat-typing')).toHaveCount(0);

  // The tutor's open chat marks it read → "Seen" on the student's side.
  await expect(mine.getByTestId('chat-receipt')).toHaveAttribute('data-kind', 'read', { timeout: 10000 });
  await expect(mine.getByTestId('chat-receipt')).toHaveAttribute('aria-label', 'Seen');

  await studentPage.context().close();
  await tutorPage.context().close();
});

test('edit and delete my own message; the other side follows live', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { tutor, student, relId, convId } = await seedChat(request);
  await say(request, student, convId, '我昨天去了公园');
  const chatPath = `/connections/${relId}/chat/${convId}`;
  const studentPage = await openAs(browser, student, chatPath);
  const tutorPage = await openAs(browser, tutor, chatPath, { width: 1280, height: 860 });
  await expect(tutorPage.getByText('我昨天去了公园')).toBeVisible({ timeout: 20000 });

  const bubble = studentPage.getByTestId('chat-message').filter({ hasText: '我昨天去了公园' });
  await bubble.getByRole('button', { name: 'More actions' }).click();
  await studentPage.locator('[data-tool="edit"]').click();
  const editBox = studentPage.getByRole('textbox', { name: 'Message text' });
  await editBox.fill('我昨天去了北海公园');
  await studentPage.getByRole('button', { name: 'Save' }).click();
  const edited = studentPage.getByTestId('chat-message').filter({ hasText: '我昨天去了北海公园' });
  await expect(edited).toBeVisible({ timeout: 10000 });
  await expect(edited.locator('.chat-edited')).toHaveText('edited');
  await expect(tutorPage.getByText('我昨天去了北海公园')).toBeVisible({ timeout: 10000 });

  await edited.getByRole('button', { name: 'More actions' }).click();
  await studentPage.locator('[data-tool="delete"]').click();
  await studentPage.getByRole('button', { name: 'Delete' }).click();
  await expect(studentPage.getByText('Message deleted')).toBeVisible({ timeout: 10000 });
  await expect(studentPage.getByText('我昨天去了北海公园')).toHaveCount(0);
  await expect(tutorPage.getByText('Message deleted')).toBeVisible({ timeout: 10000 });

  await studentPage.context().close();
  await tutorPage.context().close();
});

test('a photo is compressed, sent, and shows for both people', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { tutor, student, relId, convId } = await seedChat(request);
  await say(request, tutor, convId, '把你的作业拍给我看看。');
  const chatPath = `/connections/${relId}/chat/${convId}`;
  const studentPage = await openAs(browser, student, chatPath);
  const tutorPage = await openAs(browser, tutor, chatPath, { width: 1280, height: 860 });
  await expect(studentPage.getByText('把你的作业拍给我看看。')).toBeVisible({ timeout: 20000 });

  const png = await makePng(studentPage);
  await studentPage.getByTestId('chat-photo-input').setInputFiles({ name: 'homework.png', mimeType: 'image/png', buffer: png });
  await studentPage.getByRole('textbox', { name: 'Caption' }).fill('这是我的作业');
  await studentPage.getByTestId('photo-send').click();

  const photo = studentPage.getByTestId('chat-photo').first();
  await expect(photo).toBeVisible({ timeout: 5000 });
  await expect(studentPage.getByText('这是我的作业')).toBeVisible();
  await expect(studentPage.getByTestId('chat-send-pending')).toHaveCount(0, { timeout: 15000 });
  await expect(photo).toHaveClass(/loaded/, { timeout: 10000 });

  const tutorPhoto = tutorPage.getByTestId('chat-photo').first();
  await expect(tutorPhoto).toBeVisible({ timeout: 10000 });
  await expect(tutorPhoto).toHaveClass(/loaded/, { timeout: 15000 });
  // Sized from the attachment (120×80 → ratio kept).
  const boxSize = await tutorPhoto.boundingBox();
  expect(boxSize && Math.abs(boxSize.width / boxSize.height - 1.5)).toBeLessThan(0.05);

  await tutorPhoto.click();
  await expect(tutorPage.getByTestId('chat-photo-viewer')).toBeVisible();
  await tutorPage.keyboard.press('Escape');
  await expect(tutorPage.getByTestId('chat-photo-viewer')).toHaveCount(0);

  await studentPage.context().close();
  await tutorPage.context().close();
});

test('search, pins, and the New messages divider + unread badge', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { tutor, student, relId, convId } = await seedChat(request);
  const first = await say(request, tutor, convId, '这周的生词：苹果、香蕉');
  await say(request, student, convId, '好的，我会复习');
  // The student has read up to here.
  await api(request, `/api/conversations/${convId}/read`, { method: 'POST', token: student.token, data: {} });
  await say(request, tutor, convId, '明天考试别忘了');
  await say(request, tutor, convId, '还有，香蕉的声调是第一声');
  const pin = await api(request, `/api/messages/${first.id}/pin`, { method: 'POST', token: tutor.token, data: { pinned: true } });
  expect(pin.status).toBe(200);

  const studentPage = await openAs(browser, student, `/connections/${relId}`);
  const item = studentPage.getByTestId('one-chat-row');
  await expect(item.getByTestId('conversation-unread')).toHaveText('2', { timeout: 20000 });
  await item.click();

  // Divider before the first unread message.
  const divider = studentPage.getByTestId('chat-unread-divider');
  await expect(divider).toBeVisible({ timeout: 20000 });
  const next = divider.locator('xpath=following-sibling::*[1]');
  await expect(next).toContainText('明天考试别忘了');

  // Pinned bar → jump.
  const bar = studentPage.getByTestId('chat-pinned-bar');
  await expect(bar).toContainText('这周的生词');

  // Search: two messages mention 香蕉; ↑ goes to the older one.
  await studentPage.getByRole('button', { name: 'Search messages' }).click();
  await studentPage.getByRole('searchbox', { name: 'Search messages' }).fill('香蕉');
  await expect(studentPage.getByTestId('chat-search-count')).toHaveText('1 of 2');
  await expect(studentPage.locator('.chat-message.search-current')).toContainText('第一声');
  await studentPage.getByRole('button', { name: 'Older match' }).click();
  await expect(studentPage.getByTestId('chat-search-count')).toHaveText('2 of 2');
  await expect(studentPage.locator('.chat-message.search-current')).toContainText('这周的生词');
  await studentPage.getByRole('searchbox', { name: 'Search messages' }).fill('没有这个');
  await expect(studentPage.getByTestId('chat-search-count')).toHaveText('No matches');

  await studentPage.context().close();
});

test('offline: the message waits in the outbox and goes out when back online', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { tutor, student, relId, convId } = await seedChat(request);
  await say(request, tutor, convId, '到了告诉我');
  const studentPage = await openAs(browser, student, `/connections/${relId}/chat/${convId}`);
  await expect(studentPage.getByText('到了告诉我')).toBeVisible({ timeout: 20000 });

  await studentPage.context().setOffline(true);
  const box = studentPage.getByRole('textbox', { name: 'Message' });
  await box.fill('我在火车上，快到了');
  await box.press('Enter');
  const mine = studentPage.getByTestId('chat-message').filter({ hasText: '我在火车上，快到了' });
  await expect(mine.getByTestId('chat-send-pending')).toBeVisible({ timeout: 3000 });

  await studentPage.context().setOffline(false);
  await expect(mine.getByTestId('chat-send-pending')).toHaveCount(0, { timeout: 15000 });
  const list = await api<{ messages: Array<{ content: string }> }>(request, `/api/conversations/${convId}/messages`, { token: tutor.token });
  expect(list.body.messages.filter((m) => m.content === '我在火车上，快到了')).toHaveLength(1);
  await studentPage.context().close();
});
