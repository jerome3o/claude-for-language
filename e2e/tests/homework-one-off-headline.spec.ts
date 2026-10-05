import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * The homework headline counts one-off homework only (docs/HOMEWORK.md §11): a deck sent for
 * long-term review only never makes the tutor see "Homework 13%". With the one-off pass done,
 * the dashboard pill and the student page say "all done this week"; the long-term deck sits in
 * the quieter "Long-term learning" section and the homework library calls it "In long-term review".
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
  const email = `hwhead-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

test('a long-term deck is not homework progress: one-off done → "all done this week"', async ({ page, request }) => {
  test.setTimeout(150_000);
  const tutor = await seedUser(request, 'tutor', 'Minghui');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  const relId = rel.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });

  const words = (list: Array<[string, string, string]>) => list.map(([hanzi, pinyin, english]) => ({ hanzi, pinyin, english }));
  const longDeck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: tutor.token, data: { name: 'HSK 3 天气' } });
  await api(request, `/api/decks/${longDeck.id}/notes/batch?check=none`, {
    method: 'POST', token: tutor.token,
    data: { notes: words([['天气', 'tiānqì', 'weather'], ['下雨', 'xià yǔ', 'to rain'], ['刮风', 'guā fēng', 'to be windy'], ['晴天', 'qíngtiān', 'sunny day']]) },
  });
  const weekDeck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: tutor.token, data: { name: '第五课：在餐厅' } });
  await api(request, `/api/decks/${weekDeck.id}/notes/batch?check=none`, {
    method: 'POST', token: tutor.token,
    data: { notes: words([['菜单', 'càidān', 'menu'], ['买单', 'mǎidān', 'to pay the bill']]) },
  });

  // Long-term only, then a one-off + long-term deck with a due date.
  await api(request, `/api/relationships/${relId}/homework`, { method: 'POST', token: tutor.token, data: { items: [{ kind: 'deck', source_id: longDeck.id, mode: 'fsrs' }] } });
  const sent = await api<{ assignments: Array<{ id: string; item_ids: string[] }> }>(request, `/api/relationships/${relId}/homework`, {
    method: 'POST', token: tutor.token, data: { items: [{ kind: 'deck', source_id: weekDeck.id, mode: 'both' }] },
  });

  // Before the pass: one open one-off item.
  const before = await api<{ pills: { homework: { label: string; state: string } } }>(request, `/api/relationships/${relId}/overview?tz_offset=0`, { token: tutor.token });
  expect(before.pills.homework).toMatchObject({ state: 'open', label: '0 of 1 done' });

  // The student does the one-off pass.
  const a = sent.assignments[0];
  await api(request, '/api/me/homework/events', {
    method: 'POST', token: student.token,
    data: { events: a.item_ids.map((id, i) => ({ id: `hwhead-${a.id}-${i}`, assignment_id: a.id, item_id: id, result: 'right', created_at: new Date().toISOString() })) },
  });

  // One review, so the dashboard shows the student card's pills (not the "Getting set up" checklist).
  const decks = await api<Array<{ id: string; name: string }> | { decks: Array<{ id: string; name: string }> }>(request, '/api/decks', { token: student.token });
  const copy = (Array.isArray(decks) ? decks : decks.decks).find((d) => d.name.includes('HSK 3'))!;
  const full = await api<{ notes: Array<{ id: string }> }>(request, `/api/decks/${copy.id}`, { token: student.token });
  const note = await api<{ cards: Array<{ id: string }> }>(request, `/api/notes/${full.notes[0].id}`, { token: student.token });
  await api(request, '/api/reviews', {
    method: 'POST', token: student.token,
    data: { events: [{ id: `hwhead-review-${note.cards[0].id}`, card_id: note.cards[0].id, rating: 2, reviewed_at: new Date().toISOString() }] },
  });

  // ---- Tutor: dashboard pill
  await page.goto(`/connections?session_token=${tutor.token}`);
  await expect(page.getByTestId('td-pill-homework')).toHaveText('Homework ✓ all done this week', { timeout: 30_000 });
  await expect(page.getByText(/Homework \d+%/)).toHaveCount(0);

  // ---- Student page: the headline, and the long-term deck in its own section
  await page.goto(`/connections/${relId}`);
  await expect(page.getByTestId('homework-headline')).toHaveText('✓ All done this week', { timeout: 30_000 });
  const longTerm = page.getByTestId('long-term-learning');
  await expect(longTerm).toContainText('Not counted as homework');
  await expect(longTerm.locator('.td-hw-row', { hasText: 'HSK 3 天气' })).toBeVisible();
  await expect(longTerm).toContainText('Daily new cards');

  // ---- Homework library: neutral status, no percent for the long-term deck
  await page.goto(`/connections/${relId}/homework`);
  const libRow = page.getByTestId('hl-row').filter({ hasText: 'HSK 3 天气' });
  await expect(libRow).toBeVisible({ timeout: 30_000 });
  await expect(libRow.getByTestId('hl-status')).toHaveText('In long-term review');
  await expect(libRow).not.toContainText('%');
  await expect(page.getByTestId('hl-row').filter({ hasText: '第五课' }).getByTestId('hl-status')).toHaveText('Completed');
});
