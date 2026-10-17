import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Sign-in hardening (CLAUDE.md "Sign-in & sessions"): "Sign in with Google" sends only a PKCE
 * challenge, the return carries a one-time `?code=` that the page trades (with the verifier it
 * kept) for the session; a code this browser didn't ask for signs nobody in; Sign out revokes the
 * session on the server; Settings → "Sign out of all devices" revokes every session.
 * Google itself is stood in for by intercepting /api/auth/login and minting the code with
 * /api/test/auth-code (E2E_TEST_MODE).
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

// A pre-installed Chromium (e.g. remote dev containers); CI uses Playwright's own.
test.use({ launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}, viewport: { width: 412, height: 915 } });

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}) {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  return { status: res.status(), body: (await res.json().catch(() => null)) as T };
}

async function seedUser(request: APIRequestContext) {
  const email = `auth-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  return { email, token: r.body.session_token };
}

test('signs in with a one-time code, and sign-out revokes the session', async ({ page, request, baseURL }) => {
  const user = await seedUser(request);
  let challenge: string | null = null;
  await page.route('**/api/auth/login**', async (route) => {
    challenge = new URL(route.request().url()).searchParams.get('challenge');
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const minted = await api<{ code: string }>(request, '/api/test/auth-code', { method: 'POST', data: { email: user.email, challenge } });
    await route.fulfill({ status: 302, headers: { Location: `${baseURL}/?code=${minted.body.code}` } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /Sign in with Google/ }).click();
  await page.locator('.header').waitFor({ timeout: 30000 });
  await expect(page).not.toHaveURL(/code=/);
  const token = await page.evaluate(() => localStorage.getItem('session_token'));
  expect(token).toBeTruthy();
  expect((await api(request, '/api/auth/me', { token: token! })).status).toBe(200);

  // Sign out → the server forgets that session.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: /Sign in with Google/ })).toBeVisible({ timeout: 20000 });
  expect((await api(request, '/api/auth/me', { token: token! })).status).toBe(401);
  // The other session (from /api/test/auth) is untouched.
  expect((await api(request, '/api/auth/me', { token: user.token })).status).toBe(200);
});

test('a code this browser never asked for signs nobody in', async ({ page, request }) => {
  const user = await seedUser(request);
  const minted = await api<{ code: string }>(request, '/api/test/auth-code', { method: 'POST', data: { email: user.email, challenge: 'A'.repeat(43) } });
  await page.goto(`/?code=${minted.body.code}`);
  await expect(page.getByTestId('splash-auth-error')).toContainText('wasn’t started on this device');
  expect(await page.evaluate(() => localStorage.getItem('session_token'))).toBeNull();
});

test('sign out of all devices revokes every session of the account', async ({ page, request }) => {
  const user = await seedUser(request);
  const other = (await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email: user.email } })).body.session_token;
  await page.goto(`/settings?session_token=${user.token}`);
  await page.getByTestId('signout-all').click();
  await expect(page.getByTestId('signout-all-confirm')).toContainText('Sign out everywhere?');
  await page.getByTestId('signout-all-go').click();
  await expect(page.getByRole('button', { name: /Sign in with Google/ })).toBeVisible({ timeout: 20000 });
  expect((await api(request, '/api/auth/me', { token: user.token })).status).toBe(401);
  expect((await api(request, '/api/auth/me', { token: other })).status).toBe(401);
});
