import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * Read-aloud voice (shared/chats/voice.ts): a person picks "Your voice when your
 * messages are read aloud" on the Profile screen; the other side of the chat then
 * hears their messages in a matching voice from THEIR conversation voices, through
 * the same TTS path as the lesson exercises (/api/practice/tts) — never the
 * legacy conversations.voice_id ('female-yujie'). An admin can set it too.
 */

test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined } });

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const M = 'Chinese (Mandarin)_';

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PUT'; token?: string; data?: unknown } = {},
): Promise<{ status: number; body: T }> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  return { status: res.status(), body: (await res.json().catch(() => null)) as T };
}

async function seedUser(request: APIRequestContext, tag: string, name: string, extra: Record<string, unknown> = {}): Promise<SeededUser> {
  const email = `voice-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name, ...extra } });
  return { id: r.body.user.id, email, token: r.body.session_token };
}

async function login(page: Page, u: SeededUser, path: string) {
  await page.goto(`/?session_token=${u.token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await page.goto(path);
}

test('the Profile choice sets whose voice reads my chat messages aloud', async ({ page, request }) => {
  test.setTimeout(120_000);
  const tutor = await seedUser(request, 'tutor', '王明慧', { role: 'tutor' });
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  const relId = rel.body.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });
  const conv = await api<{ id: string }>(request, `/api/relationships/${relId}/conversations`, { method: 'POST', token: tutor.token, data: {} });
  await api(request, `/api/conversations/${conv.body.id}/messages`, { method: 'POST', token: student.token, data: { content: '老师，我明天可以早一点来吗？' } });

  // The student picks Male on the Profile screen.
  await page.setViewportSize({ width: 412, height: 915 });
  await login(page, student, '/profile');
  const row = page.getByTestId('voice-gender');
  await expect(row).toContainText('Your voice when your messages are read aloud', { timeout: 30000 });
  await expect(row.getByRole('radio', { name: 'Not set' })).toHaveAttribute('aria-checked', 'true');
  await row.getByRole('radio', { name: 'Male', exact: true }).click();
  await page.getByTestId('profile-save').click();
  await expect(page.getByText('Profile saved')).toBeVisible();

  const me = await api<{ voice_gender: string | null }>(request, '/api/auth/me', { token: student.token });
  expect(me.body.voice_gender).toBe('male');
  const seen = await api<{ recipient: { voice_gender: string | null } }>(request, `/api/relationships/${relId}`, { token: tutor.token });
  expect(seen.body.recipient.voice_gender).toBe('male');

  // The tutor reads his message aloud: the exercise TTS path, a male voice.
  const voices: string[] = [];
  await page.route('**/api/practice/tts', async (route) => {
    voices.push((route.request().postDataJSON() as { voice_id: string }).voice_id);
    await route.fulfill({ json: { audio_base64: 'SUQz', content_type: 'audio/mpeg' } });
  });
  await login(page, tutor, `/connections/${relId}/chat/${conv.body.id}`);
  const bubble = page.getByTestId('chat-message').filter({ hasText: '老师，我明天' });
  await expect(bubble).toBeVisible({ timeout: 20000 });
  await bubble.locator('.chat-bubble').click({ button: 'right' });
  await page.getByTestId('message-menu').getByText('Read aloud').click();
  await expect.poll(() => voices.length).toBeGreaterThan(0);
  expect(voices[0]).toBe(`${M}Male_Announcer`);
  expect(voices).not.toContain('female-yujie');

  // Bad values are refused.
  const bad = await api(request, '/api/profile', { method: 'PUT', token: student.token, data: { voice_gender: 'robot' } });
  expect(bad.status).toBe(400);
});

test('an admin sets another account\'s voice gender; others may not', async ({ request }) => {
  const admin = await seedUser(request, 'admin', 'Admin', { is_admin: true });
  const other = await seedUser(request, 'other', 'Minghui');
  const ok = await api<{ voice_gender: string | null }>(request, `/api/admin/users/${other.id}/voice-gender`, { method: 'PUT', token: admin.token, data: { voice_gender: 'female' } });
  expect(ok.status).toBe(200);
  expect(ok.body.voice_gender).toBe('female');
  const me = await api<{ voice_gender: string | null }>(request, '/api/auth/me', { token: other.token });
  expect(me.body.voice_gender).toBe('female');
  const cleared = await api<{ voice_gender: string | null }>(request, `/api/admin/users/${encodeURIComponent(other.email)}/voice-gender`, { method: 'PUT', token: admin.token, data: { voice_gender: null } });
  expect(cleared.body.voice_gender).toBeNull();
  expect((await api(request, `/api/admin/users/${other.id}/voice-gender`, { method: 'PUT', token: admin.token, data: { voice_gender: 'x' } })).status).toBe(400);
  expect((await api(request, `/api/admin/users/${admin.id}/voice-gender`, { method: 'PUT', token: other.token, data: { voice_gender: 'male' } })).status).toBe(403);
});
