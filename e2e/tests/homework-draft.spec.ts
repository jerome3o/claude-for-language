import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Lesson notes → homework draft → review → assign (docs/HOMEWORK.md §4).
 * The draft itself is seeded with /api/test/homework-draft (a real one is a
 * Claude run; the agent's draft mode is covered by worker unit tests). What is
 * under test: the lesson-notes list, the review page (load gauge, skipped
 * words the student already has, split over days, modes) and Assign.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {},
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
  const email = `hwd-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

test('tutor reviews a homework draft (skips known words, splits over days) and assigns it', async ({ page, request }) => {
  test.setTimeout(120_000);
  const tutor = await seedUser(request, 'tutor', 'Minghui');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  const relId = rel.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });

  const own = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: student.token, data: { name: 'HSK 2' } });
  await api(request, `/api/decks/${own.id}/notes`, { method: 'POST', token: student.token, data: { hanzi: '服务员', pinyin: 'fúwùyuán', english: 'waiter' } });

  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: tutor.token, data: { name: 'Restaurant — draft' } });
  await api(request, `/api/decks/${deck.id}/notes/batch`, {
    method: 'POST',
    token: tutor.token,
    data: { notes: [['菜单', 'càidān', 'menu'], ['服务员', 'fúwùyuán', 'waiter'], ['点菜', 'diǎn cài', 'to order food'], ['买单', 'mǎidān', 'to pay the bill'], ['辣', 'là', 'spicy']].map(([hanzi, pinyin, english]) => ({ hanzi, pinyin, english })) },
  });
  const lib = await api<{ id?: string; item?: { id: string } }>(request, '/api/lesson-library', {
    method: 'POST',
    token: tutor.token,
    data: { spec: { title: '把 sentences', sections: [{ exercises: [{ type: 'note', body: '把 moves the object before the verb.', sentences: [{ hanzi: '把门关上。', pinyin: 'Bǎ mén guān shang.', english: 'Close the door.' }] }] }] } },
  });
  const libId = lib.item?.id ?? lib.id!;
  const seeded = await api<{ job_id: string }>(request, '/api/test/homework-draft', {
    method: 'POST',
    data: { relationship_id: relId, deck_id: deck.id, deck_name: 'Restaurant — draft', library_items: [{ id: libId, title: '把 sentences' }], title: 'Restaurant ordering' },
  });

  // ---- The student page lists the entry; plain notes can be saved without a draft
  await page.goto(`/connections/${relId}?session_token=${tutor.token}`);
  const section = page.getByTestId('lesson-notes-section');
  await expect(section).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('ln-open').click();
  await page.getByTestId('ln-title').fill('Tones review');
  await page.getByTestId('ln-notes').fill('Worked on third tones: 你好, 很好.');
  await page.getByTestId('ln-draft-check').uncheck();
  await page.getByTestId('ln-submit').click();
  await expect(section.getByTestId('ln-entry').filter({ hasText: 'Tones review' })).toContainText('No homework yet');
  const entry = section.getByTestId('ln-entry').filter({ hasText: 'Restaurant ordering' });
  await expect(entry).toContainText('Draft ready');
  await entry.getByTestId('ln-review').click();

  // ---- The review page
  await expect(page).toHaveURL(new RegExp(`/connections/${relId}/homework/${seeded.job_id}`));
  await expect(page.getByTestId('load-gauge')).toBeVisible();
  const words = page.getByTestId('draft-words');
  await expect(words).toContainText('Words (4)');
  await expect(page.getByTestId('draft-skipped')).toContainText('服务员');
  await expect(page.getByTestId('draft-skipped')).toContainText('in HSK 2');
  await page.selectOption('[data-testid=draft-deck-split]', '2');
  await expect(words).toContainText('Day 2');
  await expect(page.getByTestId('draft-lesson')).toContainText('把 sentences');
  await page.getByTestId('draft-assign').click();
  await expect(page.getByTestId('draft-assigned')).toBeVisible({ timeout: 20_000 });

  const hw = await api<{ assignments: Array<{ kind: string; mode: string; item_count: number; part_count: number; batch_id: string }> }>(request, `/api/relationships/${relId}/homework`, { token: tutor.token });
  expect(hw.assignments.map((a) => [a.kind, a.mode, a.item_count, a.part_count]).sort()).toEqual([
    ['deck', 'both', 2, 2],
    ['deck', 'both', 2, 2],
    ['lesson', 'one_off', 1, 1],
  ]);
  expect(new Set(hw.assignments.map((a) => a.batch_id))).toEqual(new Set([seeded.job_id]));

  // Assigning twice is refused
  const again = await request.fetch(`${API}/api/relationships/${relId}/homework-drafts/${seeded.job_id}/assign`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tutor.token}` }, data: '{}',
  });
  expect(again.status()).toBe(409);

  // ---- The student sees it
  await page.goto(`/?session_token=${student.token}`);
  const card = page.getByTestId('homework-due-card');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByTestId('hw-row')).toHaveCount(3);
});
