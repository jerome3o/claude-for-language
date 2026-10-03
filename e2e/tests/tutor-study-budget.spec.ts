import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * The tutor sets the student's daily new-card budget: the "Daily new cards" row
 * and sheet on the student page (5 + 10), the chat message from the tutor, and
 * the student's side — /auth/me, /sync/changes and Settings showing it with
 * "Set by Minghui · <day>". The student can still change it (last write wins).
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

interface SeededUser { id: string; email: string; token: string }

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

async function seedUser(request: APIRequestContext, tag: string, name: string): Promise<SeededUser> {
  const email = `sbudget-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

test('tutor sets 5 + 10 new cards a day; the student sees it with "Set by"', async ({ page, request }) => {
  test.setTimeout(120_000);
  const tutor = await seedUser(request, 'tutor', 'Minghui Wang');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  const relId = rel.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });

  // The student can't use the tutor's endpoint.
  await api(request, `/api/relationships/${relId}/student-study-budget`, { token: student.token, expectStatus: 403 });

  // ---- Tutor: the row shows the default, Edit → 5 + 10 → Save
  await page.goto(`/connections/${relId}?session_token=${tutor.token}`);
  const row = page.getByTestId('daily-budget-row');
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.getByTestId('daily-budget-value')).toContainText('3 new words + 6 extra a day');
  await expect(row.getByTestId('daily-budget-value')).toContainText('default');
  await row.getByTestId('daily-budget-edit').click();
  const sheet = page.getByTestId('daily-budget-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('New words a day', { exact: true }).fill('5');
  await sheet.getByLabel('Extra cards a day', { exact: true }).fill('10');
  await sheet.getByTestId('daily-budget-save').click();
  await expect(sheet).toBeHidden();
  await expect(row.getByTestId('daily-budget-value')).toContainText('5 new words + 10 extra a day');
  await expect(row).toContainText('Set by you');

  // ---- The chat message from the tutor
  const convs = await api<{ id: string }[] | { data: { id: string }[] }>(request, `/api/relationships/${relId}/conversations`, { token: student.token });
  const convId = (Array.isArray(convs) ? convs : convs.data)[0].id;
  const msgs = await api<{ messages?: { content: string }[]; data?: { content: string }[] }>(request, `/api/conversations/${convId}/messages`, { token: student.token });
  expect(JSON.stringify(msgs)).toContain("I've set your new cards to 5 a day (+10 extra) 📚");

  // ---- Student: /auth/me and /sync/changes carry it, with who set it
  const me = await api<{ new_cards_per_day: number; secondary_cards_per_day: number; study_budget: { set_by_tutor: boolean; set_by_name: string } }>(request, '/api/auth/me', { token: student.token });
  expect(me).toMatchObject({ new_cards_per_day: 5, secondary_cards_per_day: 10, study_budget: { set_by_tutor: true, set_by_name: 'Minghui Wang' } });
  const changes = await api<{ study_budget: { new_cards_per_day: number } }>(request, '/api/sync/changes?since=0', { token: student.token });
  expect(changes.study_budget).toMatchObject({ new_cards_per_day: 5, secondary_cards_per_day: 10, set_by_tutor: true });

  // ---- Student Settings: the numbers, "Set by Minghui · …", and the offline mirror
  await page.goto(`/settings?session_token=${student.token}`);
  const section = page.getByTestId('daily-budget');
  await expect(section.getByTestId('budget-set-by')).toHaveText(/^Set by Minghui · \d{1,2} [A-Z][a-z]{2}$/, { timeout: 30_000 });
  await expect(section.getByLabel('New words', { exact: true })).toHaveValue('5');
  await expect(section.getByLabel('Extra cards', { exact: true })).toHaveValue('10');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('studyBudget') || 'null'))).toEqual({ new_cards_per_day: 5, secondary_cards_per_day: 10 });

  // ---- The student changes it back: their write wins and "Set by" goes away
  await section.getByLabel('New words', { exact: true }).fill('4');
  await section.getByRole('button', { name: 'Save' }).click();
  await expect(section.getByTestId('budget-set-by')).toBeHidden();
  const after = await api<{ new_cards_per_day: number; study_budget: { set_by_tutor: boolean } }>(request, '/api/auth/me', { token: student.token });
  expect(after).toMatchObject({ new_cards_per_day: 4, study_budget: { set_by_tutor: false } });
});
