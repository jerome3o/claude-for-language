import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Taking homework back (worker routes/homework-removal.ts): a tutor removes a
 * deck she shared by mistake from the student page's ⋯ menu; the confirm sheet
 * says nothing is lost when the student hasn't started; the row goes from her
 * Homework list and the deck disappears from the student's decks. Only the
 * tutor may do it, and never on the student's own deck.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST' | 'DELETE'; token?: string; data?: unknown } = {},
): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function status(request: APIRequestContext, method: 'GET' | 'DELETE', path: string, token: string): Promise<number> {
  const res = await request.fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
  return res.status();
}

async function seedUser(request: APIRequestContext, tag: string, name: string): Promise<SeededUser> {
  const email = `rmhw-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

test('a tutor removes a shared deck and it disappears from the student\'s decks', async ({ page, request }) => {
  test.setTimeout(120_000);
  const tutor = await seedUser(request, 'tutor', 'Minghui');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  const relId = rel.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });

  const own = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: student.token, data: { name: 'My own words' } });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: tutor.token, data: { name: 'HSK 1 生字表' } });
  await api(request, `/api/decks/${deck.id}/notes/batch`, {
    method: 'POST',
    token: tutor.token,
    data: { notes: [['爱', 'ài', 'to love'], ['八', 'bā', 'eight'], ['爸爸', 'bàba', 'dad']].map(([hanzi, pinyin, english]) => ({ hanzi, pinyin, english })) },
  });
  const share = await api<{ id: string; target_deck_id: string }>(request, `/api/relationships/${relId}/share-deck`, {
    method: 'POST', token: tutor.token, data: { deck_id: deck.id },
  });

  // Only the tutor; never the student's own deck.
  expect(await status(request, 'DELETE', `/api/relationships/${relId}/shared-decks/${share.id}`, student.token)).toBe(403);
  expect(await status(request, 'DELETE', `/api/relationships/${relId}/shared-decks/${own.id}`, tutor.token)).toBe(404);

  // ---- Student: the copy is in their decks
  await page.goto(`/decks?session_token=${student.token}`);
  await expect(page.getByText('HSK 1 生字表 (from tutor)').first()).toBeVisible({ timeout: 60_000 });

  // ---- Tutor: ⋯ on the homework row → Remove from Jerome's decks → confirm
  await page.goto(`/connections/${relId}?session_token=${tutor.token}`);
  const row = page.locator('.td-hw-row', { hasText: 'HSK 1 生字表' });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByTestId('queue-position').click();
  await page.getByTestId('queue-menu-remove').click();
  const sheet = page.getByTestId('remove-homework-sheet');
  await expect(sheet).toContainText("Remove “HSK 1 生字表” from Jerome's decks?");
  await expect(page.getByTestId('remove-homework-body')).toHaveText("Jerome hasn't started this — nothing is lost.");
  await expect(sheet.getByText('Also delete my copy')).toBeVisible();
  await page.getByTestId('remove-homework-confirm').click();
  await expect(page.locator('.app-toast')).toContainText("Removed “HSK 1 生字表” from Jerome's decks");
  await expect(page.locator('.td-hw-row', { hasText: 'HSK 1 生字表' })).toHaveCount(0, { timeout: 15_000 });

  // Her own deck stays; the student's own deck too.
  await api(request, `/api/decks/${deck.id}`, { token: tutor.token });
  await api(request, `/api/decks/${own.id}`, { token: student.token });
  expect(await status(request, 'GET', `/api/decks/${share.target_deck_id}`, student.token)).toBe(404);

  // ---- Student: gone after the next sync
  await page.goto(`/decks?session_token=${student.token}`);
  await expect(page.getByText('My own words').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('HSK 1 生字表 (from tutor)')).toHaveCount(0, { timeout: 30_000 });
});
