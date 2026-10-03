import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * The Chats tab (docs/CHAT.md "Chats tab"): Chats replaced Decks in the bottom
 * bar; /chats lists every conversation across tutors and students with the
 * last message, time and an unread badge; search filters it; a row opens the
 * chat and ← comes back to the inbox; Decks is the first row of More.
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
  const email = `chats-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.body.user.id, email, token: r.body.session_token };
}

async function connect(request: APIRequestContext, tutor: SeededUser, student: SeededUser): Promise<string> {
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST',
    token: tutor.token,
    data: { recipient_email: student.email, role: 'tutor' },
  });
  await api(request, `/api/relationships/${rel.body.data.id}/accept`, { method: 'POST', token: student.token });
  return rel.body.data.id;
}

async function newConversation(request: APIRequestContext, user: SeededUser, relId: string, title?: string): Promise<string> {
  const conv = await api<{ id: string }>(request, `/api/relationships/${relId}/conversations`, { method: 'POST', token: user.token, data: title ? { title } : {} });
  return conv.body.id;
}

async function say(request: APIRequestContext, user: SeededUser, convId: string, content: string) {
  const r = await api(request, `/api/conversations/${convId}/messages`, { method: 'POST', token: user.token, data: { content } });
  expect(r.status).toBe(201);
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
  await page.goto(`/?session_token=${user.token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await page.goto(path);
  return page;
}

test.describe('Chats tab', () => {
  test('inbox: every chat, newest first, unread badge, search, open and back', async ({ browser, request }) => {
    const me = await seedUser(request, 'me', 'Jerome');
    const tutor = await seedUser(request, 'tutor', '王明慧');
    const student = await seedUser(request, 'student', 'Lily');
    const relTutor = await connect(request, tutor, me);
    const relStudent = await connect(request, me, student);

    const homework = await newConversation(request, tutor, relTutor, 'Homework');
    const smallTalk = await newConversation(request, tutor, relTutor, 'Small talk');
    const lily = await newConversation(request, me, relStudent);
    await say(request, tutor, smallTalk, '周末快乐！');
    await say(request, me, lily, '明天见');
    await say(request, tutor, homework, '作业做完了吗？');
    await say(request, tutor, homework, '别忘了听写');

    const page = await openAs(browser, me, '/');
    const bar = page.getByTestId('tab-bar');
    // Has a tutor AND a student, no decks: Students · Chats · Study · More (Decks is gone from the bar).
    await expect(bar.locator('.tab-bar-label')).toHaveText(['Students', 'Chats', 'Study', 'More']);
    // Two conversations with unread messages.
    await expect(page.getByTestId('chats-tab-badge')).toHaveText('2');

    await bar.locator('[data-tab="chats"]').click();
    await expect(page).toHaveURL(/\/chats$/);
    await expect(bar.locator('[data-tab="chats"]')).toHaveAttribute('aria-current', 'page');

    const rows = page.getByTestId('chats-row');
    await expect(rows).toHaveCount(3);
    // Newest first; the title shows because there are two chats with her.
    await expect(rows.nth(0)).toContainText('王明慧');
    await expect(rows.nth(0)).toContainText('Homework');
    await expect(rows.nth(0)).toContainText('别忘了听写');
    await expect(rows.nth(0).locator('.chats-unread')).toHaveText('2');
    await expect(rows.nth(1)).toContainText('Lily');
    await expect(rows.nth(1)).toContainText('You: 明天见');
    await expect(rows.nth(1).locator('.chats-unread')).toHaveCount(0);
    await expect(rows.nth(2)).toContainText('Small talk');

    // Search by person, title and message.
    const search = page.getByRole('searchbox', { name: 'Search chats' });
    await search.fill('lily');
    await expect(rows).toHaveCount(1);
    await search.fill('周末');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Small talk');
    await search.fill('');
    await expect(rows).toHaveCount(3);

    // Open → the chat; ← → back to the inbox, now read.
    await rows.nth(0).click();
    await expect(page).toHaveURL(new RegExp(`/connections/${relTutor}/chat/${homework}`));
    await expect(page.getByText('别忘了听写')).toBeVisible();
    await page.waitForTimeout(1500); // the read marker is sent after a short debounce
    await page.getByRole('link', { name: 'Back' }).first().click();
    await expect(page).toHaveURL(/\/chats$/);
    await expect(rows.nth(0).locator('.chats-unread')).toHaveCount(0, { timeout: 15000 });

    // A new message arrives live (or on the next refresh) and moves its chat up.
    await say(request, student, lily, '老师好！');
    await expect(rows.nth(0)).toContainText('老师好！', { timeout: 30000 });
    await expect(rows.nth(0).locator('.chats-unread')).toHaveText('1');

    // New chat → pick the person when there are several.
    await page.getByRole('button', { name: 'New chat' }).click();
    await expect(page.getByRole('dialog', { name: 'New chat with' })).toContainText('Lily');
    await page.getByRole('dialog', { name: 'New chat with' }).getByRole('button', { name: /Lily/ }).click();
    await expect(page).toHaveURL(new RegExp(`/connections/${relStudent}/chat/(?!new)`), { timeout: 15000 });
    await page.context().close();
  });

  test('empty state and Decks in More', async ({ browser, request }) => {
    const loner = await seedUser(request, 'loner', 'Solo');
    const page = await openAs(browser, loner, '/chats');
    await expect(page.getByTestId('chats-empty')).toContainText('connect with a tutor or student');
    await page.getByRole('link', { name: 'Connect with someone' }).click();
    await expect(page).toHaveURL(/\/connections$/);

    await page.getByTestId('tab-bar').locator('[data-tab="more"]').click();
    await page.getByRole('link', { name: /^Decks/ }).click();
    await expect(page).toHaveURL(/\/decks$/);
    await expect(page.getByTestId('tab-bar').locator('[data-tab="more"]')).toHaveAttribute('aria-current', 'page');
    await page.context().close();
  });
});
