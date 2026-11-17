import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Old Claude practice chats (docs/CHAT.md "Practice with Claude" → "Old practice chats"): a chat
 * with Claude from before role-plays were Claude threads (`conversations.is_ai_conversation`), opened
 * by its old link `/connections/:relId/chat/:convId`, lands in its Claude thread `/chats/claude/pc-<id>`
 * with its messages — copied on demand by the server — and never in the old chat page. The old reply
 * endpoint answers 410 with the thread it moved to.
 */
const API = process.env.E2E_API_URL || 'http://localhost:8787';

test.use({ viewport: { width: 412, height: 915 } });

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<{ status: number; body: T }> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  return { status: res.status(), body: (await res.json().catch(() => null)) as T };
}

test('an old practice chat link opens its Claude thread with its messages', async ({ page, request }) => {
  test.setTimeout(120_000);
  const email = `old-practice-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  expect(auth.status).toBe(200);
  const token = auth.body.session_token;

  await page.addInitScript(() => {
    try {
      localStorage.setItem('chat-notify-nudge-dismissed', '1');
    } catch {
      /* ignore */
    }
  });
  await page.goto(`/?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30_000 });

  // Seeded after the app opened (the lazy backfill may already have run): the thread is copied on demand.
  const seeded = await api<{ relationship_id: string; conversation_id: string }>(request, '/api/test/practice-chat', {
    method: 'POST',
    data: {
      user_id: auth.body.user.id,
      title: 'Café',
      scenario: '在咖啡馆点咖啡',
      ai_role: '服务员',
      messages: [
        { from: 'claude', content: '欢迎光临！您想喝点什么？', created_at: '2026-09-30T08:00:00.000Z' },
        { from: 'me', content: '我要一杯拿铁。', created_at: '2026-09-30T08:01:00.000Z' },
        { from: 'claude', content: '好的，请稍等。', created_at: '2026-09-30T08:02:00.000Z' },
      ],
    },
  });
  expect(seeded.status).toBe(200);
  const { relationship_id: relId, conversation_id: convId } = seeded.body;

  await page.goto(`/connections/${relId}/chat/${convId}`);
  await expect(page).toHaveURL(new RegExp(`/chats/claude/pc-${convId}$`), { timeout: 30_000 });
  // Chinese shows as word chips, so the text is checked on the thread as a whole.
  const thread = page.getByTestId('claude-chat-thread');
  await expect(thread).toContainText('欢迎光临！您想喝点什么？', { timeout: 30_000 });
  await expect(page.getByTestId('claude-chat-mine')).toContainText('我要一杯拿铁。');
  await expect(thread).toContainText('好的，请稍等。');
  await expect(page.getByTestId('claude-chat-reply')).toHaveCount(2);
  // Read-only: the copy of an old chat, never the old chat page.
  await expect(page.getByTestId('claude-thread-readonly')).toBeVisible();
  await expect(page.locator('.chat-page')).toHaveCount(0);

  // Older app builds still asking the old endpoint get 410 + the thread.
  const old = await api<{ error: string; moved_to_thread: string | null }>(request, `/api/conversations/${convId}/ai-respond`, { method: 'POST', token, data: {} });
  expect(old.status).toBe(410);
  expect(old.body.moved_to_thread).toBe(`pc-${convId}`);
});
