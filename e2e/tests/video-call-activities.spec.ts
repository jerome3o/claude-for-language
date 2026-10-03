import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * In-call activities (docs/VIDEO_CALLS.md "In-call activities"): two people in a
 * call play a shared activity — the room runs the state machine, each person
 * sees their own role's view, and a reload comes back to the same state.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const LAUNCH = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};

test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'], ...LAUNCH },
  permissions: ['camera', 'microphone'],
});

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()}`);
  return (await res.json()) as T;
}

async function openAs(browser: Browser, token: string): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`/?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  return page;
}

async function joinCall(page: Page, callId: string) {
  await page.goto(`/calls/${callId}`);
  await expect(page.getByTestId('join-call')).toBeEnabled({ timeout: 20000 });
  await page.getByTestId('record-toggle').uncheck();
  await page.getByTestId('join-call').click();
  await page.getByTestId('call-live').waitFor({ timeout: 20000 });
}

async function startActivity(page: Page, id: string) {
  await page.getByLabel('More').click();
  await page.getByTestId('menu-activities').click();
  await page.locator(`[data-testid="activity-picker-row"][data-activity="${id}"]`).click();
}

async function setup(browser: Browser, request: APIRequestContext) {
  const seed = async (tag: string, name: string) => {
    const email = `calla-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
    const r = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
    return { email, token: r.session_token };
  };
  const tutor = await seed('tutor', '王老师');
  const student = await seed('student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
  const { call } = await api<{ call: { id: string } }>(request, '/api/calls', { method: 'POST', token: tutor.token, data: { relationship_id: rel.data.id } });
  const tp = await openAs(browser, tutor.token);
  const sp = await openAs(browser, student.token);
  await joinCall(tp, call.id);
  await joinCall(sp, call.id);
  return { tutor, student, call, tp, sp };
}

test('dictation: the tutor starts a word, the student types it live, the tutor reveals and marks; a reload keeps the state', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const { tutor, call, tp, sp } = await setup(browser, request);

  // The STUDENT opens it from the menu; the tutor is the reader (host) anyway.
  await startActivity(sp, 'dictation-everyday-1');
  for (const p of [tp, sp]) {
    await expect(p.getByTestId('activity-tile')).toBeVisible({ timeout: 15000 });
    await expect(p.getByTestId('call-tiles')).toHaveAttribute('data-stage', /activity/);
    await expect(p.getByTestId('activity-progress')).toHaveText('1 / 8');
  }
  await expect(tp.getByTestId('activity-role')).toHaveText('You: Reader');
  await expect(sp.getByTestId('activity-role')).toHaveText('You: Writer');
  // Only the tutor sees the word and the controls.
  await expect(tp.getByTestId('dictation-word')).toHaveText('你好');
  await expect(sp.getByTestId('dictation-word')).toHaveCount(0);
  // The student's ⋯ only ends it; skip / reset / swap are the tutor's.
  await sp.getByTestId('activity-menu').click();
  await expect(sp.getByTestId('activity-finish')).toBeVisible();
  await expect(sp.getByTestId('activity-skip')).toHaveCount(0);
  await sp.getByTestId('activity-menu').click();

  await tp.getByTestId('dictation-start').click();
  const input = sp.getByTestId('dictation-input');
  await expect(input).toBeVisible({ timeout: 10000 });
  await input.pressSequentially('你号', { delay: 60 });
  // The tutor sees it being typed.
  await expect(tp.getByTestId('dictation-live')).toContainText('你号', { timeout: 10000 });

  // The student reloads mid-round: the room gives the same session back.
  await sp.reload();
  await expect(sp.getByTestId('join-call')).toBeEnabled({ timeout: 20000 });
  await sp.getByTestId('record-toggle').uncheck();
  await sp.getByTestId('join-call').click();
  await expect(sp.getByTestId('activity-tile')).toBeVisible({ timeout: 15000 });
  await expect(sp.getByTestId('dictation-input')).toHaveValue('你号');

  await sp.getByTestId('dictation-submit').click();
  await expect(tp.getByTestId('dictation-live')).toContainText('wrote', { timeout: 10000 });
  await tp.getByTestId('dictation-reveal').click();
  for (const p of [tp, sp]) await expect(p.getByTestId('activity-verdict')).toHaveText('✗ Not quite', { timeout: 10000 });
  await expect(sp.getByTestId('dictation-diff')).toHaveAttribute('aria-label', 'Written: 你号');
  // The tutor overrides the mark (close enough) — the student sees it too.
  await tp.getByTestId('mark-right').click();
  await expect(sp.getByTestId('activity-verdict')).toHaveText('✓ Right', { timeout: 10000 });
  await expect(sp.getByTestId('activity-score')).toHaveText('✓ 1/1');
  await tp.getByTestId('activity-next').click();
  await expect(sp.getByTestId('activity-progress')).toHaveText('2 / 8', { timeout: 10000 });

  // End it: the summary on both; closing keeps it with the lesson.
  await tp.getByTestId('activity-menu').click();
  await tp.getByTestId('activity-finish').click();
  for (const p of [tp, sp]) await expect(p.getByTestId('activity-done-score')).toHaveText('1 / 1 right', { timeout: 10000 });
  await sp.getByTestId('activity-done-close').click();
  for (const p of [tp, sp]) await expect(p.getByTestId('activity-tile')).toHaveCount(0, { timeout: 10000 });
  const detail = await api<{ activities: { activity_id: string; summary: { correct: number; lines: string[] } }[] }>(request, `/api/calls/${call.id}`, { token: tutor.token });
  expect(detail.activities).toHaveLength(1);
  expect(detail.activities[0]).toMatchObject({ activity_id: 'dictation-everyday-1', summary: { correct: 1 } });
  expect(detail.activities[0].summary.lines[0]).toBe('你好 (nǐ hǎo, hello) — wrote 你号 ✓');
});

test('describe & guess and sentence building: each sees their own side; both build one sentence', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const { tp, sp } = await setup(browser, request);

  // ---- Describe & guess: the student describes, the tutor guesses.
  await startActivity(tp, 'describe-food-1');
  await expect(sp.getByTestId('describe-target')).toHaveText('苹果', { timeout: 15000 });
  await expect(tp.getByTestId('describe-target')).toHaveCount(0);
  await expect(tp.getByTestId('describe-option')).toHaveCount(4);
  await tp.getByTestId('describe-option').filter({ hasText: '苹果' }).click();
  for (const p of [tp, sp]) await expect(p.getByTestId('activity-verdict')).toContainText('got it', { timeout: 10000 });
  // Only the host moves on.
  await expect(sp.getByTestId('activity-next')).toHaveCount(0);
  await tp.getByTestId('activity-next').click();
  await expect(sp.getByTestId('describe-target')).toHaveText('香蕉', { timeout: 10000 });
  // Swap roles: now the tutor describes.
  await tp.getByTestId('activity-menu').click();
  await tp.getByTestId('activity-swap').click();
  await expect(tp.getByTestId('describe-target')).toHaveText('香蕉', { timeout: 10000 });
  await expect(sp.getByTestId('describe-option')).toHaveCount(4);

  // ---- Starting another replaces it.
  await startActivity(sp, 'build-sentences-1');
  await expect(tp.getByTestId('activity-tile')).toHaveAttribute('data-kind', 'build', { timeout: 15000 });
  const want = ['我', '把', '书', '放在', '桌子上'];
  for (const [i, w] of want.entries()) {
    const p = i % 2 ? sp : tp; // taking turns
    await p.getByTestId('build-tile').filter({ hasText: new RegExp(`^${w}$`) }).click();
    await expect((i % 2 ? tp : sp).getByTestId('build-placed')).toHaveCount(i + 1, { timeout: 10000 });
  }
  await expect(sp.getByTestId('build-answer')).toHaveText('我把书放在桌子上');
  await expect(sp.getByTestId('build-reveal')).toHaveCount(0);
  await tp.getByTestId('build-reveal').click();
  for (const p of [tp, sp]) await expect(p.getByTestId('activity-verdict')).toHaveText('✓ That’s it!', { timeout: 10000 });
  await sp.getByTestId('build-said').click();
  await expect(tp.getByText('✓ Jerome')).toBeVisible({ timeout: 10000 });
});
