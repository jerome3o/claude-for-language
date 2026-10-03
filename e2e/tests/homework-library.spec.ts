import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * The homework library and link homework (docs/HOMEWORK.md §8–10): the tutor
 * makes a link in her own account and sends it from the Send homework sheet;
 * the student opens it from their homework, marks it done with a note; the
 * tutor's library shows it Completed with the note, and the student page's
 * "Most recent homework" card turns green. Editing a sent reader offers to
 * update the student's copy.
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
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function seedUser(request: APIRequestContext, tag: string, name: string): Promise<SeededUser> {
  const email = `hwlib-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

async function pair(request: APIRequestContext) {
  const tutor = await seedUser(request, 'tutor', 'Minghui');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
  return { tutor, student, relId: rel.data.id };
}

test('tutor sends link homework → student marks it done → the library shows Completed', async ({ page, request }) => {
  test.setTimeout(150_000);
  const { tutor, student, relId } = await pair(request);
  // YouTube's thumbnail host may be unreachable in CI: serve a tiny image in its place.
  await page.route('https://i.ytimg.com/**', (r) => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"/>' }));

  // ---- Tutor: Send homework → 🔗 A link → New link (saved in HER account) → Save & send
  await page.goto(`/connections/${relId}?session_token=${tutor.token}`);
  await expect(page.getByTestId('recent-homework')).toContainText('No homework sent yet', { timeout: 30_000 });
  await page.getByRole('button', { name: '📤 Send homework' }).first().click();
  await page.getByTestId('send-link-tab').click();
  await page.getByTestId('new-link').click();
  await page.getByTestId('link-url').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.getByTestId('link-title').fill('月亮代表我的心');
  await page.getByTestId('link-instructions').fill('Listen twice and write down five words you hear.');
  await page.getByTestId('link-submit').click();
  await expect(page.locator('.td-result')).toContainText('Sent “月亮代表我的心” to Jerome', { timeout: 15_000 });

  // The link lives in her account; the student has exactly one link assignment.
  const links = await api<{ links: Array<{ id: string; title: string }> }>(request, '/api/homework-links', { token: tutor.token });
  expect(links.links.map((l) => l.title)).toEqual(['月亮代表我的心']);
  const mine = await api<{ assignments: Array<{ kind: string; details: { url: string } | null }> }>(request, '/api/me/homework', { token: student.token });
  expect(mine.assignments).toHaveLength(1);
  expect(mine.assignments[0]).toMatchObject({ kind: 'link', details: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } });

  // ---- Student: My homework → the link → open → Mark as done with a note
  await page.goto(`/homework?session_token=${student.token}`);
  const row = page.getByTestId('hw-row').filter({ hasText: '月亮代表我的心' });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(row.getByTestId('hw-status')).toHaveText('Not started');
  await row.click();
  await expect(page.getByTestId('link-pass')).toContainText('Listen twice and write down five words you hear.');
  await expect(page.getByTestId('link-open')).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await expect(page.getByTestId('link-open').locator('img')).toHaveAttribute('src', 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  await page.getByTestId('link-note').fill('我学了：月亮、代表、心、深、真');
  await page.getByTestId('link-mark-done').click();
  await expect(page.getByTestId('link-done')).toContainText('我学了：月亮、代表、心、深、真');

  // Uploaded (right away when online; poll the server).
  await expect
    .poll(async () => (await api<{ assignments: Array<{ status: string }> }>(request, '/api/me/homework', { token: student.token })).assignments[0].status, { timeout: 20_000 })
    .toBe('done');

  // ---- Tutor: the library shows Completed with the note; the top card is green
  await page.goto(`/connections/${relId}/homework?session_token=${tutor.token}`);
  const libRow = page.getByTestId('hl-row').filter({ hasText: '月亮代表我的心' });
  await expect(libRow).toBeVisible({ timeout: 30_000 });
  await expect(libRow.getByTestId('hl-status')).toHaveText('Completed');
  await expect(libRow).toContainText('100%');
  await expect(libRow).toContainText('我学了：月亮、代表、心、深、真');
  await page.getByTestId('hl-filter-completed').click();
  await expect(page.getByTestId('hl-row')).toHaveCount(1);

  await page.goto(`/connections/${relId}?session_token=${tutor.token}`);
  const recent = page.getByTestId('recent-homework');
  await expect(recent).toContainText('月亮代表我的心', { timeout: 30_000 });
  await expect(recent.getByTestId('hl-status')).toHaveText('Completed');

  // All-students library
  await page.goto(`/homework-library?session_token=${tutor.token}`);
  await expect(page.getByTestId('hl-row').filter({ hasText: 'Jerome' })).toHaveCount(1, { timeout: 30_000 });
});

test('editing a sent deck offers to update the student\'s copy', async ({ page, request }) => {
  test.setTimeout(150_000);
  const { tutor, student, relId } = await pair(request);
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: tutor.token, data: { name: '水果' } });
  await api(request, `/api/decks/${deck.id}/notes/batch`, {
    method: 'POST', token: tutor.token,
    data: { notes: [{ hanzi: '苹果', pinyin: 'píngguǒ', english: 'apple' }] },
  });
  await api(request, `/api/relationships/${relId}/homework`, {
    method: 'POST', token: tutor.token, data: { items: [{ kind: 'deck', source_id: deck.id, mode: 'both' }] },
  });

  // The library lists it as Not started (one-off pass + long-term).
  const lib = await api<{ items: Array<{ kind: string; status: string; mode: string }> }>(request, `/api/relationships/${relId}/homework-library`, { token: tutor.token });
  expect(lib.items).toEqual([expect.objectContaining({ kind: 'deck', status: 'not_started', mode: 'both' })]);

  // Add a word on the deck page → "Also update Jerome's copy?" (default on) → Update
  await page.goto(`/decks/${deck.id}?session_token=${tutor.token}`);
  await page.getByRole('button', { name: '+ Add word' }).click();
  const inputs = page.locator('.modal input');
  await inputs.nth(0).fill('香蕉');
  await inputs.nth(1).fill('xiāngjiāo');
  await inputs.nth(2).fill('banana');
  await page.locator('.modal').getByRole('button', { name: 'Save' }).click();
  const prompt = page.getByTestId('update-copies-sheet');
  await expect(prompt).toContainText("Also update Jerome's copy", { timeout: 20_000 });
  await expect(prompt.getByTestId('update-copy-check')).toBeChecked();
  await prompt.getByTestId('update-copies-confirm').click();
  await expect(prompt).toContainText('Jerome — 1 new word', { timeout: 15_000 });
  await prompt.getByRole('button', { name: 'Done' }).click();

  // The library's "Update Jerome's copy" now has nothing to add.
  await page.goto(`/connections/${relId}/homework?session_token=${tutor.token}`);
  const row = page.getByTestId('hl-row').filter({ hasText: '水果' });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await page.getByTestId('hl-update-copy').click();
  await expect(page.locator('.td-result')).toContainText("Jerome's copy: already up to date", { timeout: 15_000 });

  const words = await api<{ notes: Array<{ hanzi: string }> }>(request, `/api/decks/${(await api<Array<{ id: string; name: string }>>(request, '/api/decks', { token: student.token })).find((d) => d.name.startsWith('水果'))!.id}`, { token: student.token });
  expect(words.notes.map((n) => n.hanzi).sort()).toEqual(['苹果', '香蕉'].sort());
});
