import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Chat notifications on the web (docs/CHAT.md): opening a chat marks it read
 * (POST /api/conversations/:id/read with up_to = the newest message), and the
 * "🔔 Get notified of new messages — Turn on" nudge shows while notifications
 * are off on this browser, and stays gone once dismissed.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<{ status: number; body: T }> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  return { status: res.status(), body: (await res.json().catch(() => null)) as T };
}

async function seedUser(request: APIRequestContext, tag: string, name: string): Promise<SeededUser> {
  const email = `chatnotify-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.body.user.id, email, token: r.body.session_token };
}

test.use({ viewport: { width: 412, height: 915 } });

test('opening a chat marks it read, and the notifications nudge shows and dismisses', async ({ page, request }) => {
  test.setTimeout(90_000);
  const tutor = await seedUser(request, 'tutor', '王老师');
  const student = await seedUser(request, 'student', 'Student');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  const relId = rel.body.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });
  const conv = await api<{ id: string }>(request, `/api/relationships/${relId}/conversations`, { method: 'POST', token: tutor.token, data: {} });
  expect(conv.status).toBe(201);
  const convId = conv.body.id;
  const sent = await api<{ created_at: string }>(request, `/api/conversations/${convId}/messages`, { method: 'POST', token: tutor.token, data: { content: '你今天学习了吗？' } });
  expect(sent.status).toBe(201);

  await page.goto(`/?session_token=${student.token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  // Start from a browser that has never dismissed the nudge.
  await page.evaluate(() => localStorage.removeItem('chat-notify-nudge-dismissed'));

  const readRequest = page.waitForRequest(
    (req) => req.method() === 'POST' && new URL(req.url()).pathname === `/api/conversations/${convId}/read`,
    { timeout: 20000 },
  );
  await page.goto(`/connections/${relId}/chat/${convId}`);
  await expect(page.getByText('你今天学习了吗？')).toBeVisible({ timeout: 20000 });
  const req = await readRequest;
  expect(req.postDataJSON()).toEqual({ up_to: sent.body.created_at });

  // Headless Chromium starts with permission 'default' → push state 'off' → the nudge.
  const nudge = page.getByTestId('chat-notify-nudge');
  await expect(nudge).toBeVisible({ timeout: 10000 });
  await expect(nudge).toContainText('Get notified of new messages');
  await nudge.getByRole('button', { name: 'Dismiss' }).click();
  await expect(nudge).toHaveCount(0);

  await page.reload();
  await expect(page.getByText('你今天学习了吗？')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1000);
  await expect(page.getByTestId('chat-notify-nudge')).toHaveCount(0);
});
