import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Session notes on the tutor's student page: the section, the upload sheet
 * and the server-side validation. The agent itself is NOT started here — a
 * real job costs a Claude run; its loop is covered by worker unit tests
 * (services/__tests__/tutor-notes-agent.test.ts).
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

async function seedUser(request: APIRequestContext, tag: string): Promise<SeededUser> {
  const email = `notes-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', {
    method: 'POST',
    data: { email, name: `Notes ${tag}` },
  });
  return { id: r.user.id, email, token: r.session_token };
}

test('tutor sees the Session notes section, opens the sheet, and short notes are refused', async ({ page, request }) => {
  const tutor = await seedUser(request, 'tutor');
  const student = await seedUser(request, 'student');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  const relId = rel.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });

  // ---- API: only the tutor may submit, and the notes must have some substance
  const asStudent = await request.fetch(`${API}/api/relationships/${relId}/session-notes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${student.token}` },
    data: JSON.stringify({ notes: 'Today we learned 点菜, 菜单 and 服务员 at the restaurant.' }),
  });
  expect(asStudent.status()).toBe(403);
  const tooShort = await request.fetch(`${API}/api/relationships/${relId}/session-notes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${tutor.token}` },
    data: JSON.stringify({ notes: '点菜' }),
  });
  expect(tooShort.status()).toBe(400);
  const empty = await api<{ jobs: unknown[] }>(request, `/api/relationships/${relId}/session-notes`, { token: tutor.token });
  expect(empty.jobs).toEqual([]);

  // ---- UI: the section on the student page and the sheet
  await page.goto(`/connections/${relId}?session_token=${tutor.token}`);
  const section = page.getByTestId('session-notes-section');
  await expect(section).toBeVisible({ timeout: 30000 });
  await expect(section).toContainText('After a lesson, paste your notes here');
  await page.getByTestId('sn-open').click();
  const notes = page.getByTestId('sn-notes');
  await expect(notes).toBeVisible();
  const start = page.getByTestId('sn-submit');
  await expect(start).toBeDisabled();
  await notes.fill('Lesson today: 点菜 diǎn cài, 菜单 càidān, 服务员 fúwùyuán. He said 我想点菜。');
  await expect(start).toBeEnabled();
  await expect(page.getByText('characters')).toBeVisible();
  // The delivery options are there: send automatically + queue position + lesson log
  await expect(page.getByText('Core', { exact: false })).toBeVisible();
  await expect(page.getByText('Also log this as a lesson', { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(notes).toBeHidden();
});
