import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Finding the call: when the tutor starts a video call, the student sees
 * "📹 <tutor> is calling — Join" on Home, as a bar on other pages, on the
 * tutor page and in the chat; Join opens the call. Also checks the push
 * endpoints (a key is generated when no VAPID secrets are set).
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; token?: string; data?: unknown } = {}): Promise<{ status: number; body: T }> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  return { status: res.status(), body: (await res.json().catch(() => null)) as T };
}

async function seedUser(request: APIRequestContext, tag: string, name: string): Promise<SeededUser> {
  const email = `alert-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.body.user.id, email, token: r.body.session_token };
}

test.use({ viewport: { width: 412, height: 915 } });

test('the student finds a call the tutor started: Home card, top bar, tutor page, chat, Join', async ({ page, request }) => {
  test.setTimeout(90_000);
  const tutor = await seedUser(request, 'tutor', '王老师');
  const student = await seedUser(request, 'student', 'Student');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  await api(request, `/api/relationships/${rel.body.data.id}/accept`, { method: 'POST', token: student.token });

  await page.goto(`/?session_token=${student.token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await expect(page.getByTestId('home-call-banner')).toHaveCount(0);

  const call = await api<{ call: { id: string } }>(request, '/api/calls', { method: 'POST', token: tutor.token, data: { relationship_id: rel.body.data.id } });
  expect(call.status).toBe(201);
  const callId = call.body.call.id;

  // Home: the big card (the poll picks it up; a reload is the quickest way here).
  await page.reload();
  const card = page.getByTestId('home-call-banner');
  await expect(card).toBeVisible({ timeout: 30000 });
  await expect(card).toContainText('王老师 is calling');

  // Another page: the bar across the top.
  await page.goto('/decks');
  const bar = page.getByTestId('call-alert-banner');
  await expect(bar).toBeVisible({ timeout: 30000 });
  await expect(bar).toContainText('王老师 is calling');

  // The tutor page and the chat show it inline.
  await page.goto(`/connections/${rel.body.data.id}`);
  await expect(page.getByTestId('live-call-banner')).toContainText('王老师 is calling', { timeout: 30000 });
  await expect(page.getByTestId('call-alert-banner')).toHaveCount(0);

  const conv = await api<{ conversation_id?: string; id?: string }>(request, `/api/relationships/${rel.body.data.id}/conversations/open`, { method: 'POST', token: student.token });
  const convId = conv.body.conversation_id ?? conv.body.id;
  await page.goto(`/connections/${rel.body.data.id}/chat/${convId}`);
  await expect(page.getByTestId('live-call-banner')).toContainText('王老师 is calling', { timeout: 30000 });

  // Hiding the bar keeps it hidden on other pages for this session.
  await page.goto('/decks');
  await page.getByTestId('call-alert-banner').getByRole('button', { name: 'Hide' }).click();
  await expect(page.getByTestId('call-alert-banner')).toHaveCount(0);
  await page.goto('/more');
  await expect(page.getByTestId('call-alert-banner')).toHaveCount(0);

  // Join from the tutor page opens the call.
  await page.goto(`/connections/${rel.body.data.id}`);
  await page.getByTestId('live-call-banner').getByTestId('call-banner-join').click();
  await page.waitForURL(new RegExp(`/calls/${callId}$`));

  // Once it ends the banners go away.
  await api(request, `/api/calls/${callId}/end`, { method: 'POST', token: tutor.token });
  await page.goto('/');
  await page.locator('.header').waitFor();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('home-call-banner')).toHaveCount(0);
});

test('push endpoints: a VAPID key, subscription validation, the ring setting', async ({ request }) => {
  const u = await seedUser(request, 'push', 'Pusher');
  const cfg = await api<{ public_key: string; call_alerts: string; subscriptions: number }>(request, '/api/push/config', { token: u.token });
  expect(cfg.status).toBe(200);
  expect(cfg.body.public_key).toMatch(/^[A-Za-z0-9_-]{86,88}$/);
  expect(cfg.body.call_alerts).toBe('ring');
  const again = await api<{ public_key: string }>(request, '/api/push/config', { token: u.token });
  expect(again.body.public_key).toBe(cfg.body.public_key);

  const bad = await api(request, '/api/push/subscriptions', { method: 'POST', token: u.token, data: { endpoint: 'http://nope', keys: {} } });
  expect(bad.status).toBe(400);

  const set = await api<{ call_alerts: string }>(request, '/api/profile/call-alerts', { method: 'PUT', token: u.token, data: { call_alerts: 'silent' } });
  expect(set.body.call_alerts).toBe('silent');
  const me = await api<{ call_alerts: string }>(request, '/api/auth/me', { token: u.token });
  expect(me.body.call_alerts).toBe('silent');
});
