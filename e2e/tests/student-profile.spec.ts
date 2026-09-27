import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * The tutor's private student profile: written on the student page (starting
 * from an example), shown as a summary afterwards, hinted at on the Students
 * dashboard until it exists — and never visible to the student (their tutor
 * page has no such section; the API answers 403). What the agents do with it
 * is covered by worker unit tests.
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
  const email = `sprof-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

test('tutor writes a private student profile from an example; the student never sees it', async ({ page, request }) => {
  test.setTimeout(120_000);
  const tutor = await seedUser(request, 'tutor', 'Minghui');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  const relId = rel.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });

  // ---- Dashboard: a quiet hint while there is no profile
  await page.goto(`/connections?session_token=${tutor.token}`);
  const hint = page.getByTestId('td-profile-hint');
  await expect(hint).toBeVisible({ timeout: 30_000 });
  await hint.click();

  // ---- Student page: empty state explains how it's used and offers examples
  await expect(page).toHaveURL(new RegExp(`/connections/${relId}`));
  const section = page.getByTestId('student-profile-section');
  await expect(section).toBeVisible({ timeout: 30_000 });
  await expect(section).toContainText('Only you can see this');
  await expect(section.getByTestId('sp-empty')).toContainText('Claude reads this whenever it makes homework, mini lessons, readers or cards for Jerome');
  await expect(section.getByTestId('sp-empty')).toContainText('Jerome never sees it');

  await section.getByTestId('sp-start-child-writer').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByTestId('sp-body')).toHaveValue(/stroke-order writing practice|Stroke-order writing practice/);
  await expect(sheet.getByTestId('sp-level-beginner')).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByTestId('sp-handwriting-true')).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByTestId('sp-words')).toHaveValue('10');
  // Make it his: change a field, add a line, save.
  await sheet.getByTestId('sp-words').fill('12');
  const body = sheet.getByTestId('sp-body');
  await body.fill(`${await body.inputValue()}\nLoves dinosaurs.`);
  await sheet.getByTestId('sp-save').click();
  await expect(sheet).toBeHidden();

  const summary = section.getByTestId('sp-summary');
  await expect(summary).toContainText('Beginner');
  await expect(summary).toContainText('Writes by hand');
  await expect(summary).toContainText('~12 new words / lesson');
  await expect(summary).toContainText('9 years old');

  // Edit → the editor opens with the saved profile; "Insert" appends an example.
  await section.getByTestId('sp-edit').click();
  await expect(sheet.getByTestId('sp-body')).toHaveValue(/Loves dinosaurs\./);
  await sheet.getByTestId('sp-use-intermediate-writing').click();
  await expect(sheet.getByTestId('sp-body')).toHaveValue(/Loves dinosaurs\.\n\nUpper-intermediate/);
  page.once('dialog', (d) => void d.accept()); // "Discard your changes?"
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toBeHidden();

  // ---- Stored for the tutor; the dashboard hint is gone
  const saved = await api<{ profile: { words_per_lesson: number; body: string } }>(request, `/api/relationships/${relId}/student-profile`, { token: tutor.token });
  expect(saved.profile.words_per_lesson).toBe(12);
  expect(saved.profile.body).toContain('Loves dinosaurs.');
  await page.goto(`/connections?session_token=${tutor.token}`);
  await expect(page.locator('.td-card').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('td-profile-hint')).toHaveCount(0);

  // ---- The student: 403 from the API, and no section on their tutor page
  const denied = await api<{ error: string }>(request, `/api/relationships/${relId}/student-profile`, { token: student.token, expectStatus: 403 });
  expect(JSON.stringify(denied)).not.toContain('dinosaurs');
  await api(request, `/api/relationships/${relId}/student-profile`, { method: 'PUT', token: student.token, data: { body: 'hi' }, expectStatus: 403 });
  await page.goto(`/connections/${relId}?session_token=${student.token}`);
  await expect(page.getByText('Minghui').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('student-profile-section')).toHaveCount(0);
  await expect(page.getByText('Loves dinosaurs')).toHaveCount(0);
});
