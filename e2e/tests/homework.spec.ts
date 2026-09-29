import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Homework assignments (docs/HOMEWORK.md): the tutor sends a deck as ONE-OFF
 * homework with a due date from the Send-homework sheet (words the student
 * already has are left out), the student sees it on Home with its due label,
 * does the one-off pass ("Not yet" words come back until right), and the
 * tutor's student page shows it done.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PATCH'; token?: string; data?: unknown } = {},
): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function seedUser(request: APIRequestContext, tag: string, name: string): Promise<SeededUser> {
  const email = `hw-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

interface Assignment { id: string; title: string; status: string; done_count: number; item_count: number; due_date: string | null; mode: string }

test('tutor sends a one-off deck with a due date; the student does the pass; the tutor sees it done', async ({ page, request }) => {
  test.setTimeout(120_000);
  const tutor = await seedUser(request, 'tutor', 'Minghui');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  const relId = rel.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });

  // The student already has 服务员 — it must be left out of the copy.
  const own = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: student.token, data: { name: 'HSK 2' } });
  await api(request, `/api/decks/${own.id}/notes`, { method: 'POST', token: student.token, data: { hanzi: '服务员', pinyin: 'fúwùyuán', english: 'waiter' } });

  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: tutor.token, data: { name: 'Restaurant 点菜' } });
  await api(request, `/api/decks/${deck.id}/notes/batch`, {
    method: 'POST',
    token: tutor.token,
    data: { notes: [['菜单', 'càidān', 'menu'], ['服务员', 'fúwùyuán', 'waiter'], ['买单', 'mǎidān', 'to pay the bill']].map(([hanzi, pinyin, english]) => ({ hanzi, pinyin, english })) },
  });

  // Only the tutor may assign; bad input is refused.
  const asStudent = await request.fetch(`${API}/api/relationships/${relId}/homework`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${student.token}` },
    data: JSON.stringify({ items: [{ kind: 'deck', source_id: deck.id, mode: 'one_off' }] }),
  });
  expect(asStudent.status()).toBe(403);
  const badMode = await request.fetch(`${API}/api/relationships/${relId}/homework`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${tutor.token}` },
    data: JSON.stringify({ items: [{ kind: 'deck', source_id: deck.id, mode: 'sometimes' }] }),
  });
  expect(badMode.status()).toBe(400);

  // ---- Tutor: Send homework → the deck → One-off, due tomorrow
  await page.goto(`/connections/${relId}?session_token=${tutor.token}`);
  await expect(page.getByTestId('assigned-homework')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Send homework/ }).first().click();
  await page.locator('.td-sheet .td-option', { hasText: 'Restaurant 点菜' }).click();
  await page.locator('.td-sheet .hwt-mode', { hasText: 'One-off' }).click();
  await page.locator('.td-sheet .hwt-chip', { hasText: 'Tomorrow' }).click();
  await page.locator('.td-sheet').getByRole('button', { name: /^Send Restaurant/ }).click();
  await expect(page.locator('.td-result')).toContainText('as one-off homework by');
  await expect(page.locator('.td-result')).toContainText('服务员');

  const { assignments } = await api<{ assignments: Assignment[] }>(request, `/api/relationships/${relId}/homework`, { token: tutor.token });
  expect(assignments).toHaveLength(1);
  expect(assignments[0]).toMatchObject({ mode: 'one_off', item_count: 2, status: 'active' });

  // ---- Student: Home shows it with its due label; the pass
  await page.goto(`/?session_token=${student.token}`);
  const card = page.getByTestId('homework-home-card');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText('Restaurant 点菜');
  await expect(card.getByTestId('hw-due')).toHaveText('due tomorrow');
  await card.getByTestId('home-hw-row').first().click();

  await expect(page.getByTestId('hw-pass-card')).toBeVisible();
  await expect(page.getByTestId('hw-pass-count')).toHaveText('0/2');
  const first = await page.locator('.hw-pass-hanzi').textContent();
  await page.getByTestId('hw-show').click();
  await page.getByTestId('hw-notyet').click();
  // The missed word comes back after the other one
  await expect(page.locator('.hw-pass-hanzi')).not.toHaveText(first!);
  await page.getByTestId('hw-show').click();
  await page.getByTestId('hw-gotit').click();
  await expect(page.getByTestId('hw-pass-count')).toHaveText('1/2');
  await expect(page.locator('.hw-pass-hanzi')).toHaveText(first!);
  await page.getByTestId('hw-show').click();
  await page.getByTestId('hw-gotit').click();
  await expect(page.getByTestId('hw-pass-done')).toBeVisible();
  // One-off only: the student may keep the words for good
  await expect(page.getByRole('button', { name: 'Add to my daily review' })).toBeVisible();

  // ---- The tutor sees it done (events uploaded right away when online)
  await expect
    .poll(async () => (await api<{ assignments: Assignment[] }>(request, `/api/relationships/${relId}/homework`, { token: tutor.token })).assignments[0].status, { timeout: 20_000 })
    .toBe('done');
  const after = await api<{ assignments: Assignment[] }>(request, `/api/relationships/${relId}/homework`, { token: tutor.token });
  expect(after.assignments[0].done_count).toBe(2);
});
