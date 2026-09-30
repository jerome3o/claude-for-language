import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * Finding the call: when the tutor starts a video call and is in it, the
 * student sees "📹 <tutor> is calling — Join" on Home, as a bar on other
 * pages, on the tutor page and in the chat; Join opens the call. A call
 * nobody is connected to is never announced, and the banner goes once the
 * tutor leaves (the room's presence, docs/VIDEO_CALLS.md "Who is in the
 * call"). Two people pressing "call" at once get ONE call. Also checks the
 * push endpoints (a key is generated when no VAPID secrets are set).
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

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  },
  permissions: ['camera', 'microphone'],
  viewport: { width: 412, height: 915 },
});

/** The tutor in their own browser, joined to the call (so the room counts them as present). */
async function tutorJoins(browser: Browser, token: string, callId: string): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 412, height: 915 } });
  const tp = await ctx.newPage();
  await tp.goto(`/?session_token=${token}`);
  await tp.locator('.header').waitFor({ timeout: 30000 });
  await tp.goto(`/calls/${callId}`);
  await expect(tp.getByTestId('join-call')).toBeEnabled({ timeout: 20000 });
  await tp.getByTestId('join-call').click();
  await tp.getByTestId('call-waiting').waitFor({ timeout: 20000 });
  return tp;
}

test('the student finds a call the tutor is in: Home card, top bar, tutor page, chat, Join — and it goes when the tutor leaves', async ({ page, request, browser }) => {
  test.setTimeout(150_000);
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

  // The call exists but nobody is in it yet: no banner, and the list says nobody is present.
  const listed = await api<{ calls: Array<{ id: string; present_user_ids?: string[] }> }>(request, '/api/calls?live=1', { token: student.token });
  expect(listed.body.calls.find((c) => c.id === callId)?.present_user_ids).toEqual([]);
  await page.reload();
  await page.locator('.header').waitFor();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('home-call-banner')).toHaveCount(0);

  // The student presses "call" at the same moment: they get the same call, not a second one.
  const glare = await api<{ call: { id: string }; reused?: boolean }>(request, '/api/calls', { method: 'POST', token: student.token, data: { relationship_id: rel.body.data.id } });
  expect(glare.status).toBe(200);
  expect(glare.body.call.id).toBe(callId);
  expect(glare.body.reused).toBe(true);

  const tp = await tutorJoins(browser, tutor.token, callId);
  await expect.poll(async () => (await api<{ calls: Array<{ id: string; present_user_ids?: string[] }> }>(request, '/api/calls?live=1', { token: student.token })).body.calls.find((c) => c.id === callId)?.present_user_ids, { timeout: 15000 }).toEqual([tutor.id]);

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

  // The inline banner can be hidden too.
  await page.evaluate(() => sessionStorage.clear()); // forget the bar hidden above
  await page.goto(`/connections/${rel.body.data.id}`);
  await expect(page.getByTestId('live-call-banner')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('live-call-banner').getByRole('button', { name: 'Hide' }).click();
  await expect(page.getByTestId('live-call-banner')).toHaveCount(0);

  // The tutor leaves (goes to another page): nobody is in the call, so it is no longer "calling".
  await tp.goto('/decks');
  await expect.poll(async () => (await api<{ calls: Array<{ id: string; present_user_ids?: string[] }> }>(request, '/api/calls?live=1', { token: student.token })).body.calls.find((c) => c.id === callId)?.present_user_ids, { timeout: 15000 }).toEqual([]);
  await page.evaluate(() => sessionStorage.clear()); // forget the hidden banners
  await page.goto('/');
  await page.locator('.header').waitFor();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('home-call-banner')).toHaveCount(0);

  // The tutor comes back; Join from the tutor page opens the call.
  await tp.goto(`/calls/${callId}`);
  await expect(tp.getByTestId('join-call')).toBeEnabled({ timeout: 20000 });
  await tp.getByTestId('join-call').click();
  await tp.getByTestId('call-waiting').waitFor({ timeout: 20000 });
  await page.goto(`/connections/${rel.body.data.id}`);
  await page.getByTestId('live-call-banner').getByTestId('call-banner-join').click({ timeout: 30000 });
  await page.waitForURL(new RegExp(`/calls/${callId}$`));

  // Once it ends the banners go away.
  await api(request, `/api/calls/${callId}/end`, { method: 'POST', token: tutor.token });
  await page.goto('/');
  await page.locator('.header').waitFor();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('home-call-banner')).toHaveCount(0);
  await tp.context().close();
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
