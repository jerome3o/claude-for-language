import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Create, then send (Minghui, Oct 2026): what the assistant makes from a
 * tutor's lesson stays in HER account — the student has nothing — until she
 * presses "Send to <student>" on the result.
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
  const email = `send-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

async function studentDeckNames(request: APIRequestContext, token: string): Promise<string[]> {
  const decks = await api<Array<{ name: string }>>(request, '/api/decks', { token });
  return decks.map((d) => d.name);
}

test('a deck the tutor generates reaches the student only when she presses Send', async ({ page, request }) => {
  test.setTimeout(120_000);
  const tutor = await seedUser(request, 'tutor', 'Minghui');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  const relId = rel.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });

  // The tutor's content: a deck the session-notes assistant made from her lesson.
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: tutor.token, data: { name: '饭馆点菜' } });
  await api(request, `/api/decks/${deck.id}/notes/batch`, {
    method: 'POST',
    token: tutor.token,
    data: { notes: [['菜单', 'càidān', 'menu'], ['服务员', 'fúwùyuán', 'waiter'], ['买单', 'mǎidān', 'to pay the bill']].map(([hanzi, pinyin, english]) => ({ hanzi, pinyin, english })) },
  });
  const { job_id } = await api<{ job_id: string }>(request, '/api/test/session-notes-job', {
    method: 'POST', data: { relationship_id: relId, deck_id: deck.id, deck_name: '饭馆点菜', title: 'Restaurant' },
  });

  // ---- Nothing has reached the student.
  expect(await studentDeckNames(request, student.token)).not.toContain('饭馆点菜 (from tutor)');
  const before = await api<{ assignments: unknown[] }>(request, '/api/me/homework', { token: student.token });
  expect(before.assignments).toEqual([]);

  // ---- Tutor: the result says "not sent" and offers Send to Jerome.
  await page.goto(`/connections/${relId}/session-notes?session_token=${tutor.token}`);
  const card = page.getByTestId('sn-job').first();
  await expect(card).toContainText('饭馆点菜', { timeout: 30_000 });
  await expect(card).toContainText('in your library, not sent');
  const send = card.getByTestId('sn-send');
  await expect(send).toHaveText('Send to Jerome');

  page.once('dialog', (d) => {
    expect(d.message()).toBe('Send "饭馆点菜" to Jerome as homework? It shows up in their app on their next sync.');
    void d.accept();
  });
  await send.click();
  await expect(card).toContainText('sent to Jerome', { timeout: 15_000 });
  await expect(card.getByTestId('sn-send')).toHaveCount(0);

  // ---- Now the student has it, as homework.
  expect(await studentDeckNames(request, student.token)).toContain('饭馆点菜 (from tutor)');
  const after = await api<{ assignments: Array<{ kind: string }> }>(request, '/api/me/homework', { token: student.token });
  expect(after.assignments.map((a) => a.kind)).toContain('deck');

  // Sending twice is refused — nothing is left to send.
  const again = await request.fetch(`${API}/api/relationships/${relId}/session-notes/${job_id}/send`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tutor.token}` }, data: '{}',
  });
  expect(again.status()).toBe(400);
});
