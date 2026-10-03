import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * One chat per pair (docs/CHAT.md "One chat per pair"): a tutor and a student
 * have ONE conversation. Older extra conversations were merged into it by
 * migration 0102 — an old link still opens it, every message shows in order,
 * the inbox has one row for the person, and nothing offers a second chat.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {},
): Promise<{ status: number; body: T }> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  return { status: res.status(), body: (await res.json().catch(() => null)) as T };
}

async function seedUser(request: APIRequestContext, tag: string, name: string): Promise<SeededUser> {
  const email = `onechat-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.body.user.id, email, token: r.body.session_token };
}

async function seedMergedPair(request: APIRequestContext) {
  const tutor = await seedUser(request, 'tutor', '王明慧');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST',
    token: tutor.token,
    data: { recipient_email: student.email, role: 'tutor' },
  });
  const relId = rel.body.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });
  // Messages that used to live in two conversations ("Welcome" and "Homework"), now one chat.
  const seeded = await api<{ conversation_id: string; merged_ids: string[] }>(request, '/api/test/merged-chats', {
    method: 'POST',
    data: {
      relationship_id: relId,
      old_titles: ['Welcome', 'Homework'],
      messages: [
        { sender_id: tutor.id, content: '欢迎！我是你的老师。', created_at: '2026-09-01T09:00:00.000Z' },
        { sender_id: tutor.id, content: '作业：复习第三课', created_at: '2026-09-10T09:00:00.000Z' },
        { sender_id: student.id, content: '我做完了', created_at: '2026-09-11T09:00:00.000Z' },
        { sender_id: tutor.id, content: '很好！明天见', created_at: '2026-09-20T09:00:00.000Z' },
      ],
    },
  });
  expect(seeded.status).toBe(200);
  return { tutor, student, relId, convId: seeded.body.conversation_id, oldIds: seeded.body.merged_ids };
}

async function openAs(browser: Browser, user: SeededUser, path: string): Promise<Page> {
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
  await page.goto(`/?session_token=${user.token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await page.goto(path);
  return page;
}

test.describe('One chat per pair', () => {
  test('an old conversation link opens the one chat with every message in order; no second chat on offer', async ({ browser, request }) => {
    test.setTimeout(120_000);
    const { student, relId, convId, oldIds } = await seedMergedPair(request);

    // The API answers an old id as the chat it became; a second chat can't be made.
    const old = await api<{ id: string; merged_from: string }>(request, `/api/conversations/${oldIds[0]}`, { token: student.token });
    expect(old.body).toMatchObject({ id: convId, merged_from: oldIds[0] });
    const second = await api<{ id: string }>(request, `/api/relationships/${relId}/conversations`, { method: 'POST', token: student.token, data: { title: 'Another' } });
    expect(second.body.id).toBe(convId);

    // An old link (a notification, an e-mail) → the one chat.
    const page = await openAs(browser, student, `/connections/${relId}/chat/${oldIds[1]}`);
    await expect(page).toHaveURL(new RegExp(`/connections/${relId}/chat/${convId}$`), { timeout: 20000 });
    const bubbles = page.getByTestId('chat-message');
    await expect(bubbles).toHaveCount(4, { timeout: 20000 });
    const texts = await bubbles.allInnerTexts();
    const order = ['欢迎！我是你的老师。', '作业：复习第三课', '我做完了', '很好！明天见'].map((t) => texts.findIndex((x) => x.includes(t)));
    expect(order).toEqual([0, 1, 2, 3]);
    // No conversation title in the header.
    await expect(page.locator('.chat-header-title')).toHaveCount(0);

    // The header menu: no new conversation, no title, no "all conversations".
    await page.getByRole('button', { name: 'Conversation menu' }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('Make flashcards');
    await expect(menu).not.toContainText('New conversation');
    await expect(menu).not.toContainText('Rename');
    await expect(menu).not.toContainText('Add a title');
    await expect(menu).not.toContainText('All conversations');
    await page.keyboard.press('Escape');

    // The inbox: one row for her, no old titles.
    await page.goto('/chats');
    const rows = page.getByTestId('chats-row');
    await expect(rows).toHaveCount(1, { timeout: 20000 });
    await expect(rows.first()).toContainText('王明慧');
    await expect(rows.first()).toContainText('很好！明天见');
    await expect(rows.first()).not.toContainText('Homework');
    await expect(rows.first()).not.toContainText('Welcome');

    // The tutor page: one "Messages" row, no list of conversations; it opens the chat.
    await page.goto(`/connections/${relId}`);
    const entry = page.getByTestId('one-chat-row');
    await expect(entry).toBeVisible({ timeout: 20000 });
    await expect(entry).toContainText('很好！明天见');
    await expect(page.getByTestId('conversation-item')).toHaveCount(0);
    await entry.click();
    await expect(page).toHaveURL(new RegExp(`/connections/${relId}/chat/${convId}$`), { timeout: 20000 });
    await page.context().close();
  });

  test('/connections/:relId/chat opens the one chat, creating it on first use', async ({ browser, request }) => {
    test.setTimeout(120_000);
    const tutor = await seedUser(request, 'tutor2', '李老师');
    const student = await seedUser(request, 'student2', 'Lily');
    const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
      method: 'POST',
      token: tutor.token,
      data: { recipient_email: student.email, role: 'tutor' },
    });
    const relId = rel.body.data.id;
    await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });

    const page = await openAs(browser, tutor, `/connections/${relId}/chat`);
    await expect(page).toHaveURL(new RegExp(`/connections/${relId}/chat/[^/]+$`), { timeout: 20000 });
    const first = page.url().split('/').pop();
    // The old "new conversation" link lands in the same chat.
    await page.goto(`/connections/${relId}/chat/new`);
    await expect(page).toHaveURL(new RegExp(`/connections/${relId}/chat/${first}$`), { timeout: 20000 });
    await page.context().close();
  });
});
