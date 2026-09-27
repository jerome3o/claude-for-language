import { test, expect, Page, APIRequestContext } from '@playwright/test';

/**
 * Admin account tools + the tutor-first app.
 *
 *  - the admin sets an account's role from the Admin page (and the admin API
 *    refuses non-admins);
 *  - a tutor account opens on Students, has Students · Decks · Library · More,
 *    a teaching home with no study nagging, and can try a deck without a
 *    single review being recorded;
 *  - the admin deletes an account after typing its email.
 *
 * Self-contained: seeds users through /api/test/auth (E2E_TEST_MODE=true).
 * Override the ports with E2E_API_URL / E2E_BASE_URL.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; token?: string; data?: unknown; expectStatus?: number } = {},
): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  const expected = opts.expectStatus ?? 200;
  if (res.status() !== expected && !(opts.expectStatus === undefined && res.ok())) {
    throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} (wanted ${expected}) ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function seedUser(request: APIRequestContext, tag: string, extra: { role?: 'tutor' | 'student'; is_admin?: boolean } = {}): Promise<SeededUser> {
  const email = `admin-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', {
    method: 'POST',
    data: { email, name: `Admin spec ${tag}`, ...extra },
  });
  return { id: r.user.id, email, token: r.session_token };
}

async function login(page: Page, u: SeededUser, path = '/') {
  const sep = path.includes('?') ? '&' : '?';
  await page.goto(`${path}${sep}session_token=${u.token}`);
  await page.locator('.header, .deck-try').first().waitFor({ timeout: 30000 });
}

// Phone viewport: the app is used folded on a Pixel; the admin list is cards there.
test.use({ viewport: { width: 412, height: 915 } });

test.describe('admin: roles and accounts', () => {
  test('non-admins get 403 from the admin API', async ({ request }) => {
    const someone = await seedUser(request, 'plain');
    await api(request, `/api/admin/users/${encodeURIComponent(someone.email)}/inspect`, { token: someone.token, expectStatus: 403 });
  });

  test('the admin makes an account a tutor; the tutor gets the tutor-first app and can try a deck without recording', async ({ page, request }) => {
    const admin = await seedUser(request, 'boss', { is_admin: true });
    const tutor = await seedUser(request, 'tutor');
    const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: tutor.token, data: { name: '边…边… lesson' } });
    await api(request, `/api/decks/${deck.id}/notes`, { method: 'POST', token: tutor.token, data: { hanzi: '一边', pinyin: 'yībiān', english: 'while' } });

    // Admin page → Manage → Tutor.
    await login(page, admin, '/admin');
    await page.getByPlaceholder('Find by email or name').fill(tutor.email);
    await page.locator('.user-card').filter({ hasText: tutor.email }).getByRole('button', { name: /Manage/ }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText(tutor.email)).toBeVisible();
    await sheet.getByRole('radio', { name: /Tutor/ }).click();
    await expect(sheet.getByRole('radio', { name: /Tutor/ })).toHaveAttribute('aria-checked', 'true');
    const inspected = await api<{ user: { role: string } }>(request, `/api/admin/users/${tutor.id}/inspect`, { token: admin.token });
    expect(inspected.user.role).toBe('tutor');

    // The tutor: lands on Students, tutor tabs, teaching home without study nagging.
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await login(page, tutor, '/');
    await expect(page).toHaveURL(/\/connections/);
    const tabs = page.getByTestId('tab-bar').locator('[data-tab]');
    await expect(tabs).toHaveCount(4);
    expect(await tabs.evaluateAll((els) => els.map((e) => e.getAttribute('data-tab')))).toEqual(['students', 'decks', 'library', 'more']);

    // In-app `/` (the deck page's Back link) is the teaching home: no study button, no streak.
    await page.goto(`/decks/${deck.id}`);
    await expect(page.getByRole('link', { name: /Try it as a student/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Study/ })).toHaveCount(0);
    await page.locator('.deck-back-link').click();
    await expect(page.getByRole('heading', { name: 'Try it as your student' })).toBeVisible();
    await expect(page.getByText("Study today's cards")).toHaveCount(0);

    // Try the deck from the teaching home: preview, reveal, nothing recorded.
    await page.getByRole('link', { name: /边…边… lesson/ }).click();
    await expect(page.getByText('Preview · nothing is recorded')).toBeVisible();
    await expect(page.locator('.deck-try-hanzi')).toHaveText('一边');
    await page.getByRole('button', { name: 'Show answer' }).click();
    await expect(page.locator('.deck-try-pinyin')).toHaveText('yībiān');
    const after = await api<{ counts: { review_events: number } }>(request, `/api/admin/users/${tutor.id}/inspect`, { token: admin.token });
    expect(after.counts.review_events).toBe(0);
  });

  test('the admin deletes an account after typing its email', async ({ page, request }) => {
    const admin = await seedUser(request, 'boss2', { is_admin: true });
    const doomed = await seedUser(request, 'doomed');
    await api(request, '/api/decks', { method: 'POST', token: doomed.token, data: { name: 'To go' } });

    await login(page, admin, '/admin');
    await page.getByPlaceholder('Find by email or name').fill(doomed.email);
    await page.locator('.user-card').filter({ hasText: doomed.email }).getByRole('button', { name: /Manage/ }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: 'Delete this account…' }).click();
    await expect(sheet.getByText('This permanently deletes:')).toBeVisible();
    const del = sheet.getByRole('button', { name: 'Delete account forever' });
    await expect(del).toBeDisabled();
    await sheet.getByRole('textbox').fill(doomed.email);
    await del.click();
    await expect(sheet).toHaveCount(0);
    await expect(page.locator('.user-card').filter({ hasText: doomed.email })).toHaveCount(0);
    await api(request, `/api/admin/users/${doomed.id}/inspect`, { token: admin.token, expectStatus: 404 });
  });
});
