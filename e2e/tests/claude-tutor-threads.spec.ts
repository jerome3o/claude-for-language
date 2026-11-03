import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * What a tutor can read of her student's chats with Claude (docs/CHAT.md "Claude threads" → "What
 * your tutor sees"; shared/claude/visibility.ts): by default the questions asked on a card; a plain
 * chat stays private until the learner shares it from the thread's ⋯; the tutor reads it read-only.
 *
 * Self-contained: a tutor, a student and their pairing through the E2E test-auth endpoint and the
 * public API; Claude is the E2E stand-in (E2E_TEST_MODE).
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH'; token?: string; data?: unknown } = {},
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
  const email = `claude-tutor-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

test('card questions are visible by default; the learner shares a plain chat; the tutor reads it read-only', async ({ page, request }) => {
  test.setTimeout(120_000);
  const tutor = await seedUser(request, 'tutor', 'Minghui');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  const relId = rel.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: student.token, data: { name: 'HSK 2' } });
  const note = await api<{ id: string }>(request, `/api/decks/${deck.id}/notes`, {
    method: 'POST', token: student.token, data: { hanzi: '银行', pinyin: 'yínháng', english: 'bank' },
  });

  // The student asks Claude on the card, and in a plain chat.
  await api(request, '/api/claude/threads', {
    method: 'POST', token: student.token, data: { client_id: `card-${Date.now()}`, context: { kind: 'card', note_id: note.id }, text: '行在这里怎么读？', language: 'zh' },
  });
  const general = await api<{ thread: { id: string } }>(request, '/api/claude/threads', {
    method: 'POST', token: student.token, data: { client_id: `gen-${Date.now()}`, context: { kind: 'general' }, text: '成都有什么好吃的？', language: 'zh' },
  });

  // ---- The tutor: only the card question, with its chip.
  await page.goto(`/connections/${relId}?session_token=${tutor.token}`);
  const section = page.getByTestId('claude-chats-section');
  await expect(section).toBeVisible({ timeout: 30000 });
  await expect(section.getByTestId('student-claude-thread')).toHaveCount(1, { timeout: 15000 });
  await expect(section.getByTestId('student-claude-chip')).toHaveText('📇 Asked on card · 银行');
  await expect(section).not.toContainText('成都有什么好吃的');
  // The plain chat is "not found" for her.
  const hidden = await request.fetch(`${API}/api/relationships/${relId}/claude-threads/${general.thread.id}`, { headers: { Authorization: `Bearer ${tutor.token}` } });
  expect(hidden.status()).toBe(404);

  // ---- The student shares the plain chat from its ⋯.
  await page.goto(`/chats/claude/${general.thread.id}?session_token=${student.token}`);
  await expect(page.getByTestId('claude-chat-reply').first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('claude-thread-shared')).toHaveCount(0);
  await page.getByTestId('claude-thread-more').click();
  await expect(page.getByTestId('claude-thread-share')).toHaveText('👁 Share with my tutor');
  await page.getByTestId('claude-thread-share').click();
  await expect(page.getByTestId('claude-thread-shared')).toContainText('can read this chat');

  // ---- The tutor sees it and reads it read-only.
  await page.goto(`/connections/${relId}?session_token=${tutor.token}`);
  await expect(section.getByTestId('student-claude-thread')).toHaveCount(2, { timeout: 30000 });
  await section.getByText('成都有什么好吃的？').first().click();
  await expect(page.getByTestId('claude-thread-readonly')).toContainText('Read only');
  await expect(page.getByTestId('claude-thread')).toContainText('成都有什么好吃的？');
  await expect(page.getByTestId('claude-chat-reply').first()).toBeVisible();
  await expect(page.locator('.claude-chat-composer')).toHaveCount(0);
  await expect(page.getByTestId('claude-thread-more')).toHaveCount(0);
});
