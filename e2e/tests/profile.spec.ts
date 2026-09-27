import { test, expect, Page, APIRequestContext } from '@playwright/test';

/**
 * Profile screen: a tutor edits her name, photo (crop → upload), About me and
 * time zone; her student sees them on the tutor page, and her invite link shows
 * the About me. Self-contained (E2E test-auth + the public API); override the
 * worker with E2E_API_URL.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; token?: string; data?: unknown } = {},
): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function seedUser(request: APIRequestContext, tag: string, extra: Record<string, unknown> = {}): Promise<SeededUser> {
  const email = `profile-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', {
    method: 'POST',
    data: { email, name: `Profile ${tag}`, ...extra },
  });
  return { id: r.user.id, email, token: r.session_token };
}

async function pair(request: APIRequestContext, tutor: SeededUser, student: SeededUser): Promise<string> {
  const r = await api<{ type: string; data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  await api(request, `/api/relationships/${r.data.id}/accept`, { method: 'POST', token: student.token });
  return r.data.id;
}

async function login(page: Page, u: SeededUser, path: string) {
  const sep = path.includes('?') ? '&' : '?';
  await page.goto(`${path}${sep}session_token=${u.token}`);
}

/** A real PNG to pick as the new photo: a screenshot of a coloured square. */
async function photoPng(page: Page): Promise<Buffer> {
  await page.setContent('<div id="p" style="width:300px;height:200px;background:linear-gradient(135deg,#f97316,#db2777)"></div>');
  return page.locator('#p').screenshot();
}

test.describe('Profile', () => {
  test('tutor edits her profile and photo; the student sees them', async ({ page, request }) => {
    const tutor = await seedUser(request, 'tutor', { role: 'tutor' });
    const student = await seedUser(request, 'student');
    const relId = await pair(request, tutor, student);
    await page.setViewportSize({ width: 412, height: 915 });

    const png = await photoPng(page);
    await login(page, tutor, '/profile');
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByLabel('About me for students')).toBeVisible();

    await page.getByLabel('Display name').fill('明慧老师 Minghui');
    await page.getByLabel('About me for students').fill('Mandarin teacher from Shanghai.\nMessage me any time!');
    await page.getByLabel('Time zone').selectOption('Asia/Shanghai');
    await page.getByTestId('profile-save').click();
    await expect(page.getByText('Profile saved')).toBeVisible();

    await page.getByTestId('photo-input').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByRole('dialog', { name: 'Position your photo' })).toBeVisible();
    await page.getByTestId('crop-confirm').click();
    await expect(page.getByText('Photo updated')).toBeVisible();

    const profile = await api<{ name: string; picture_url: string; picture_source: string; about: string; time_zone: string }>(request, '/api/profile', { token: tutor.token });
    expect(profile).toMatchObject({ name: '明慧老师 Minghui', picture_source: 'upload', time_zone: 'Asia/Shanghai' });
    expect(profile.picture_url).toMatch(/\/api\/audio\/avatars\/.+\.jpg$/);
    const img = await request.get(profile.picture_url);
    expect(img.ok()).toBe(true);
    expect(img.headers()['content-type']).toBe('image/jpeg');

    // The student's tutor page shows the edited name, photo, About me and local time.
    await login(page, student, `/connections/${relId}`);
    await expect(page.getByRole('heading', { name: '明慧老师 Minghui' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('person-about')).toContainText('Mandarin teacher from Shanghai.');
    await expect(page.getByTestId('person-about')).toContainText('in Shanghai');
    await expect(page.locator('.td-student-head img')).toHaveAttribute('src', profile.picture_url);

    // Bad input comes back as problems.
    const bad = await request.fetch(`${API}/api/profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${tutor.token}` },
      data: JSON.stringify({ time_zone: 'Mars/Base', name: '' }),
    });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).problems).toHaveLength(2);

    // "Use my Google photo" / remove.
    const removed = await api<{ picture_url: string | null; picture_source: string }>(request, '/api/profile/picture?use=none', { method: 'DELETE', token: tutor.token });
    expect(removed).toMatchObject({ picture_url: null, picture_source: 'none' });
  });

  test('invite link shows the inviter\'s About me', async ({ request, page }) => {
    const tutor = await seedUser(request, 'inviter', { role: 'tutor', is_admin: true });
    await api(request, '/api/profile', { method: 'PUT', token: tutor.token, data: { about: 'I teach HSK 1–4 online.' } });
    const invite = await api<{ id: string }>(request, '/api/invites', { method: 'POST', token: tutor.token, data: { inviter_role: 'tutor' } });
    const pub = await api<{ inviter_about: string }>(request, `/api/invites/${invite.id}/public`);
    expect(pub.inviter_about).toBe('I teach HSK 1–4 online.');
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto(`/join/${invite.id}`);
    await expect(page.getByTestId('join-about')).toHaveText('I teach HSK 1–4 online.', { timeout: 30000 });
  });
});
