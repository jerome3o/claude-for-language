import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Homework rows (docs/HOMEWORK.md §3d): a started deck pass shows the retry bar on Home (blue + the
 * orange "Not yet" part), a row's ⋯ menu skips the tutor's homework after a confirm that says she
 * will see it (Undo in the toast), /homework lists it under Skipped with Bring back, and the tutor's
 * student page says "Skipped by <student>".
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: string; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function seedUser(request: APIRequestContext, tag: string, name: string) {
  const email = `rowmenu-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

test('a started row has the retry bar; ⋯ → Skip this homework; the tutor sees "Skipped by Jerome"', async ({ page, request }) => {
  test.setTimeout(120_000);
  const tutor = await seedUser(request, 'tutor', 'Minghui');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  const relId = rel.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });

  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: tutor.token, data: { name: '餐厅点菜' } });
  await api(request, `/api/decks/${deck.id}/notes/batch`, {
    method: 'POST', token: tutor.token,
    data: { notes: [['菜单', 'càidān', 'menu'], ['服务员', 'fúwùyuán', 'waiter'], ['买单', 'mǎidān', 'to pay the bill']].map(([hanzi, pinyin, english]) => ({ hanzi, pinyin, english })) },
  });
  const deck2 = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: tutor.token, data: { name: '天气' } });
  await api(request, `/api/decks/${deck2.id}/notes`, { method: 'POST', token: tutor.token, data: { hanzi: '下雨', pinyin: 'xià yǔ', english: 'to rain' } });
  const today = new Date().toISOString().slice(0, 10);
  await api(request, `/api/relationships/${relId}/homework`, {
    method: 'POST', token: tutor.token,
    data: { today, items: [{ kind: 'deck', source_id: deck.id, mode: 'one_off', due_date: today }, { kind: 'deck', source_id: deck2.id, mode: 'one_off', due_date: today }] },
  });
  const mine = await api<{ assignments: Array<{ id: string; title: string; item_ids: string[] }> }>(request, '/api/me/homework', { token: student.token });
  const started = mine.assignments.find((a) => a.title.startsWith('餐厅'))!;
  await api(request, '/api/me/homework/events', {
    method: 'POST', token: student.token,
    data: { events: [
      { id: `r-${Date.now()}`, assignment_id: started.id, item_id: started.item_ids[0], result: 'right', created_at: new Date(Date.now() - 60_000).toISOString() },
      { id: `w-${Date.now()}`, assignment_id: started.id, item_id: started.item_ids[1], result: 'wrong', created_at: new Date().toISOString() },
    ] },
  });

  await page.goto(`/?session_token=${student.token}`);
  const card = page.getByTestId('homework-home-card');
  await expect(card).toBeVisible({ timeout: 30_000 });
  const startedRow = page.getByTestId('home-hw-row-wrap').filter({ hasText: '餐厅点菜' });
  const freshRow = page.getByTestId('home-hw-row-wrap').filter({ hasText: '天气' });
  await expect(startedRow.getByTestId('hw-row-bar')).toHaveAttribute('data-retries', '1');
  await expect(freshRow.getByTestId('hw-row-bar')).toHaveCount(0);

  await freshRow.getByTestId('row-menu-btn').click();
  await page.getByTestId('row-action-skip_homework').click();
  await expect(page.getByTestId('row-actions-confirm')).toContainText('will see it as skipped');
  await page.getByTestId('row-actions-confirm-go').click();
  await expect(page.getByTestId('row-actions-toast')).toContainText('Skipped');
  await expect(freshRow).toHaveCount(0);

  await page.goto('/homework');
  await expect(page.getByTestId('hw-skipped')).toContainText('天气');

  // The skip reaches the tutor (uploaded at once when online).
  await expect.poll(async () => {
    const r = await api<{ assignments: Array<{ title: string; skipped_at?: string | null }> }>(request, `/api/relationships/${relId}/homework?today=${today}`, { token: tutor.token });
    return r.assignments.find((a) => a.title.startsWith('天气'))?.skipped_at ?? null;
  }, { timeout: 20_000 }).not.toBeNull();
  await page.goto(`/connections/${relId}?session_token=${tutor.token}`);
  await expect(page.getByTestId('tutor-hw-skipped')).toContainText('Skipped by Jerome', { timeout: 30_000 });

  // Bring it back.
  await page.goto(`/homework?session_token=${student.token}`);
  await page.getByTestId('hw-undo-skip').click();
  await expect(page.getByTestId('hw-skipped')).toHaveCount(0);
});

/**
 * Jerome's path: Home → "All ›" → /homework, where revisions (old test lessons of his own) are listed;
 * long-press one → Stop revising — done for good · Delete lesson; Delete (confirmed) removes it at
 * once and it never comes back as a revision — the server has the delete after the sync.
 */
test('Home → /homework: long-press a revision → Delete lesson; it never comes back', async ({ page, request }) => {
  test.setTimeout(120_000);
  const me = await seedUser(request, 'rev', 'Jerome');
  const choice = (q: string) => ({ type: 'choice', question: q, options: [{ hanzi: '对', pinyin: 'duì', english: 'right' }, { hanzi: '错', pinyin: 'cuò', english: 'wrong' }], correct: 0 });
  const ids: string[] = [];
  for (const title of ['test lesson 1', 'test lesson 2', 'China trip 1 · 在机场']) {
    const r = await api<{ lesson?: { id: string }; id?: string }>(request, '/api/custom-lessons', {
      method: 'POST', token: me.token, data: { spec: { title, sections: [{ exercises: [choice('A?'), choice('B?')] }] } },
    });
    ids.push(r.lesson?.id ?? r.id!);
  }
  // Each finished 8 days ago with a miss → a revision due today.
  const at = new Date(Date.now() - 8 * 86_400_000).toISOString();
  await api(request, '/api/custom-lessons/offline-complete', {
    method: 'POST', token: me.token,
    data: { events: ids.map((id, i) => ({ id: `c${i}-${Date.now()}`, lesson_id: id, correct: 1, total: 2, completed_at: at, outcome: { keys: ['s0e0', 's0e1'], missed: ['s0e1'] } })) },
  });

  await page.goto(`/?session_token=${me.token}`);
  await expect(page.getByTestId('homework-home-card')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: /All|more/ }).first().click();
  await expect(page).toHaveURL(/\/homework$/);
  const rows = page.getByTestId('hw-lesson-rows');
  const target = rows.getByTestId('home-hw-row-wrap').filter({ hasText: 'test lesson 2' });
  await expect(target).toBeVisible({ timeout: 20_000 });

  // Long-press (touch) on the row.
  const link = target.getByTestId('home-hw-row');
  const box = (await link.boundingBox())!;
  const at0 = { clientX: box.x + 40, clientY: box.y + box.height / 2, pointerType: 'touch', isPrimary: true, bubbles: true };
  await link.dispatchEvent('pointerdown', at0);
  await page.waitForTimeout(700);
  await link.dispatchEvent('pointerup', at0);
  await expect(page.getByTestId('row-action-done_for_good')).toContainText('Stop revising — done for good');
  await page.getByTestId('row-action-delete_lesson').click();
  await expect(page.getByTestId('row-actions-confirm')).toContainText('Delete “test lesson 2”');
  await page.getByTestId('row-actions-confirm-go').click();
  await expect(page.getByTestId('row-actions-toast')).toContainText('Lesson deleted');
  await expect(rows.getByText('test lesson 2')).toHaveCount(0);

  // The server has it gone; a reload (and its sync) never brings it back.
  await expect.poll(async () => {
    const r = await api<{ lessons: Array<{ id: string }> }>(request, '/api/custom-lessons?status=all', { token: me.token });
    return r.lessons.some((l) => l.id === ids[1]);
  }, { timeout: 20_000 }).toBe(false);
  await page.reload();
  await expect(page.getByTestId('hw-lesson-rows')).toContainText('test lesson 1', { timeout: 20_000 });
  await expect(page.getByText('test lesson 2')).toHaveCount(0);
});
