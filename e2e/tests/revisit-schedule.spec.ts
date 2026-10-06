import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * "Revisit later" for mini lessons and graded readers (shared/study/revisit.ts):
 * finishing a lesson with Good sends it two weeks out — it is not offered again
 * today; "Done for good" retires one; Settings → "Lessons & readers" saves the
 * account's gaps (and rejects Hard > Good).
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const DAY = 86_400_000;

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

async function seedUser(request: APIRequestContext, tag: string): Promise<SeededUser> {
  const email = `revisit-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  return { id: r.user.id, email, token: r.session_token };
}

const lessonSpec = (title: string) => ({
  title,
  icon: '☕',
  sections: [{
    exercises: [{
      type: 'note',
      title: '要 + drink',
      body: '要 is the everyday way to order: 我要一杯咖啡。',
      sentences: [{ hanzi: '我要一杯咖啡。', pinyin: 'Wǒ yào yì bēi kāfēi.', english: 'I want a cup of coffee.' }],
    }],
  }],
});

async function finishLessonInStudy(page: import('@playwright/test').Page, title: string) {
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 });
  // The note card: read it and move on.
  await page.getByRole('button', { name: /next|continue|got it/i }).first().click();
  await expect(page.getByText('How well do you know this material now?')).toBeVisible();
}

test('finishing a lesson with Good: back in two weeks, not offered again today', async ({ page, request }) => {
  test.setTimeout(120_000);
  const user = await seedUser(request, 'good');
  const created = await api<{ lesson: { id: string } } | { id: string }>(request, '/api/custom-lessons', {
    method: 'POST', token: user.token, data: { spec: lessonSpec('Ordering at a café') },
  });
  const lessonId = 'lesson' in created ? created.lesson.id : created.id;

  await page.goto(`/study?autostart=true&session_token=${user.token}`);
  await finishLessonInStudy(page, 'Ordering at a café');

  // The rating row shows the revisit gaps and "Done for good".
  const footer = page.locator('.study-rating-sticky');
  await expect(footer.getByRole('button', { name: /Again\s*1 day/ })).toBeVisible();
  await expect(footer.getByRole('button', { name: /Good\s*2 wk/ })).toBeVisible();
  await expect(footer.getByRole('button', { name: /Easy\s*6 wk/ })).toBeVisible();
  await expect(footer.getByTestId('done-for-good')).toBeVisible();
  await footer.getByRole('button', { name: /Good/ }).click();
  await expect(page.getByText('How well do you know this material now?')).toBeHidden({ timeout: 15_000 });

  // The completion reached the server with its rating…
  await expect.poll(async () => {
    const list = await api<{ lessons: Array<{ id: string; completions?: Array<{ rating: number | null }> }> }>(request, '/api/custom-lessons?status=all', { token: user.token });
    return list.lessons.find(l => l.id === lessonId)?.completions?.map(c => c.rating) ?? [];
  }, { timeout: 30_000 }).toEqual([2]);

  // …and a new study session today does not offer it again.
  await page.goto(`/study?autostart=true&session_token=${user.token}`);
  await page.waitForTimeout(3000);
  await expect(page.getByText('How well do you know this material now?')).toBeHidden();
  await expect(page.getByText('Ordering at a café')).toHaveCount(0);

  // The Mini Lessons page says when it comes back.
  await page.goto(`/lessons?session_token=${user.token}`);
  const due = new Date(Date.now() + 14 * DAY).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  await expect(page.getByText(`Next revisit ${due}`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Coming back later \(1\)/)).toBeVisible();
});

test('Done for good retires a lesson; Bring back puts it in rotation again', async ({ page, request }) => {
  test.setTimeout(120_000);
  const user = await seedUser(request, 'dfg');
  await api(request, '/api/custom-lessons', { method: 'POST', token: user.token, data: { spec: lessonSpec('Tones of 一') } });

  await page.goto(`/study?autostart=true&session_token=${user.token}`);
  await finishLessonInStudy(page, 'Tones of 一');
  await page.getByTestId('done-for-good').click();
  await expect(page.getByText('How well do you know this material now?')).toBeHidden({ timeout: 15_000 });

  // The retire event reaches the server (idempotent upload).
  await expect.poll(async () => {
    const r = await api<{ events: Array<{ action: string; item_kind: string }> }>(request, '/api/me/revisit', { token: user.token });
    return r.events.map(e => `${e.item_kind}:${e.action}`);
  }, { timeout: 30_000 }).toEqual(['lesson:retire']);

  await page.goto(`/lessons?session_token=${user.token}`);
  await expect(page.getByText(/Done for good \(1\)/)).toBeVisible({ timeout: 30_000 });
  await page.getByText('Tones of 一').click();
  await page.getByTestId('lesson-bring-back').click();
  await expect(page.getByText(/Up next \(1\)/)).toBeVisible();
});

test('Settings → Lessons & readers saves the gaps; bad ones are refused', async ({ page, request }) => {
  test.setTimeout(90_000);
  const user = await seedUser(request, 'settings');

  // The API validates (Hard must not exceed Good).
  const bad = await api<{ problems: string[] }>(request, '/api/profile/revisit-settings', {
    method: 'PUT', token: user.token, data: { hard_days: 30 }, expectStatus: 400,
  });
  expect(bad.problems).toEqual(['the gaps must go up: Hard ≤ Good ≤ Easy']);

  await page.goto(`/settings?session_token=${user.token}`);
  const section = page.getByTestId('revisit-settings');
  await expect(section).toBeVisible({ timeout: 30_000 });
  await expect(section.getByTestId('revisit-chain')).toContainText('2 wk → 4 wk → 8 wk → 4 mo → 6 mo');
  await section.getByTestId('revisit-good_days').fill('10');
  await section.getByTestId('revisit-growth').fill('1.5');
  await section.getByTestId('revisit-save').click();
  await expect(section.getByTestId('revisit-save')).toContainText('Saved');

  const me = await api<{ revisit_settings: Record<string, unknown> }>(request, '/api/auth/me', { token: user.token });
  expect(me.revisit_settings).toMatchObject({ good_days: 10, growth: 1.5, hard_days: 2, easy_days: 42, cap_days: 180, is_default: false });
  const changes = await api<{ revisit_settings: Record<string, unknown> }>(request, '/api/sync/changes?since=0', { token: user.token });
  expect(changes.revisit_settings).toMatchObject({ good_days: 10, growth: 1.5 });

  // Survives a reload (server + device mirror), and Reset to defaults puts everything back.
  await page.reload();
  await expect(section.getByTestId('revisit-good_days')).toHaveValue('10', { timeout: 30_000 });
  await section.getByTestId('revisit-reset').click();
  await expect(section.getByTestId('revisit-good_days')).toHaveValue('14');
  const after = await api<{ revisit_settings: Record<string, unknown> }>(request, '/api/auth/me', { token: user.token });
  expect(after.revisit_settings).toMatchObject({ good_days: 14, growth: 2, is_default: true });
});
