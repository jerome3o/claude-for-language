import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * "Example sentence style" (docs/STUDY_SESSION.md "Example sentence style"): Everyday by default on /auth/me and
 * /sync/changes; Settings → Study shows the three choices, a tap saves it (a reload still shows it), bad values are
 * refused, null resets. New sentences are written — and recorded — in the chosen style (the generator's E2E stand-in).
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PUT'; token?: string; data?: unknown; expectStatus?: number } = {},
): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (opts.expectStatus !== undefined) {
    expect(res.status()).toBe(opts.expectStatus);
    return (await res.json()) as T;
  }
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

test('Settings → Study → Example sentence style: Everyday by default, saved, validated, used for new sentences', async ({ page, request }) => {
  test.setTimeout(120_000);
  const email = `sentence-style-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const token = auth.session_token;

  expect((await api<{ sentence_style: string }>(request, '/api/auth/me', { token })).sentence_style).toBe('everyday');
  expect((await api<{ sentence_style: string }>(request, '/api/sync/changes?since=2020-01-01T00:00:00.000Z', { token })).sentence_style).toBe('everyday');

  await api(request, '/api/profile/sentence-style', { method: 'PUT', token, data: { sentence_style: 'slang' }, expectStatus: 400 });
  await api(request, '/api/profile/sentence-style', { method: 'PUT', token, data: {}, expectStatus: 400 });

  await page.goto(`/settings?session_token=${token}`);
  const setting = page.getByTestId('sentence-style');
  await expect(setting).toBeVisible({ timeout: 30_000 });
  await expect(setting).toContainText('Applies to new example sentences');
  await expect(setting.getByTestId('sentence-style-everyday')).toBeChecked();

  const saved = page.waitForResponse((r) => r.url().includes('/api/profile/sentence-style') && r.request().method() === 'PUT');
  await setting.getByTestId('sentence-style-casual').check();
  expect((await saved).ok()).toBe(true);
  await expect(setting.getByTestId('sentence-style-casual')).toBeChecked();
  expect((await api<{ sentence_style: string }>(request, '/api/auth/me', { token })).sentence_style).toBe('casual');

  await page.reload();
  await expect(page.getByTestId('sentence-style-casual')).toBeChecked({ timeout: 30_000 });

  // New sentences are written in the owner's style (the E2E stand-in; the row records it).
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'Style deck' } });
  const note = await api<{ id: string }>(request, `/api/decks/${deck.id}/notes`, {
    method: 'POST',
    token,
    data: { hanzi: '东西', pinyin: 'dōngxi', english: 'thing' },
  });
  const generated = await api<{ sentences: Array<{ hanzi: string; style?: string | null; is_card?: number }> }>(
    request,
    `/api/notes/${note.id}/sentences/generate`,
    { method: 'POST', token, data: { count: 3 } },
  );
  const set = generated.sentences.filter((s) => !s.is_card);
  expect(set.length).toBeGreaterThan(0);
  expect(set.every((s) => s.style === 'casual')).toBe(true);

  // null resets to the default.
  const reset = await api<{ sentence_style: string; is_default: boolean }>(request, '/api/profile/sentence-style', { method: 'PUT', token, data: { sentence_style: null } });
  expect(reset).toEqual({ sentence_style: 'everyday', is_default: true });
});
