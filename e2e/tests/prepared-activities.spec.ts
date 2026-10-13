import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * Prepared in-call activities (docs/VIDEO_CALLS.md "Prepared activities"): the tutor
 * prepares activities for her student's next lesson on the student page (E2E_TEST_MODE runs
 * the generator inline with a fake model), previews / dismisses / restores one, sees what the
 * student has covered, then in a call finds them first in ⋯ → 🎲 Activities and starts one
 * for both. The student never sees the prepared list.
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
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1280, height: 860 } });
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

async function openActivities(page: Page) {
  await page.getByLabel('More').click();
  await page.getByTestId('menu-activities').click();
  await expect(page.getByTestId('activity-picker')).toBeVisible();
}

test('the tutor prepares activities from earlier lessons, previews and dismisses one, and starts one in the call', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const seed = async (tag: string, name: string) => {
    const email = `prep-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
    const r = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
    return { email, token: r.session_token };
  };
  const tutor = await seed('tutor', '王老师');
  const student = await seed('student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
  const relId = rel.data.id;
  // Last lesson's report (a recorded video lesson) — what the activities follow up on.
  await api(request, '/api/test/call-lesson-report', {
    method: 'POST',
    data: {
      relationship_id: relId,
      report: {
        summary: 'Talked about being ill and seeing a doctor.',
        topics: ['Health & body vocabulary', 'Seeing a doctor'],
        vocabulary: [
          { hanzi: '头疼', pinyin: 'tóuténg', english: 'headache' },
          { hanzi: '发烧', pinyin: 'fāshāo', english: 'to have a fever' },
          { hanzi: '咳嗽', pinyin: 'késou', english: 'to cough' },
          { hanzi: '感冒', pinyin: 'gǎnmào', english: 'a cold' },
          { hanzi: '嗓子', pinyin: 'sǎngzi', english: 'throat' },
        ],
        corrections: [
          { said: '我很头疼', better: '我头很疼', explanation: 'The body part is the subject' },
          { said: '我有发烧', better: '我发烧了', explanation: '发烧 is a verb' },
          { said: '我吃药了把', better: '我把药吃了', explanation: '把 + object before the verb' },
        ],
      },
    },
  });
  // A logged lesson: what the coverage lists (a lesson without a recorded call).
  await api(request, `/api/relationships/${relId}/lesson-log`, { method: 'POST', token: tutor.token, data: { lesson_at: new Date().toISOString(), notes: '看病: 头疼, 发烧, 咳嗽 — 我头很疼 not 我很头疼' } });
  // The student can't read (or make) the tutor's prepared list.
  const denied = await request.fetch(`${API}/api/relationships/${relId}/prepared-activities`, { headers: { Authorization: `Bearer ${student.token}` } });
  expect(denied.status()).toBe(403);

  const tp = await openAs(browser, tutor.token);
  await tp.goto(`/connections/${relId}`);
  const section = tp.getByTestId('prepared-activities');
  await expect(section).toBeVisible({ timeout: 20000 });
  await expect(tp.getByTestId('prepared-headline')).toHaveText(/No activities ready/);
  await expect(tp.getByTestId('coverage-section')).toContainText('2 lessons');
  await expect(tp.getByTestId('coverage-section')).toContainText('Health & body vocabulary');

  await tp.getByTestId('prepared-make').click();
  await expect(tp.getByTestId('prepared-headline')).toHaveText(/Ready for next lesson: 5 activities/, { timeout: 20000 });
  await expect(section.getByTestId('prepared-row')).toHaveCount(5);
  // Preview: what's in it.
  await section.getByTestId('prepared-row').first().locator('.pa-row-main').click();
  await expect(section.getByTestId('prepared-preview')).toContainText('头疼');
  // Dismiss one, then Undo.
  await section.getByTestId('prepared-dismiss').nth(1).click();
  await expect(section.getByTestId('prepared-row')).toHaveCount(4);
  await section.getByRole('button', { name: 'Undo' }).click();
  await expect(section.getByTestId('prepared-row')).toHaveCount(5);

  // In the call: first in the tutor's Activities menu; the student's menu has no prepared section.
  const { call } = await api<{ call: { id: string } }>(request, '/api/calls', { method: 'POST', token: tutor.token, data: { relationship_id: relId } });
  const sp = await openAs(browser, student.token);
  await joinCall(tp, call.id);
  await joinCall(sp, call.id);
  await openActivities(sp);
  await expect(sp.getByTestId('activity-picker-prepared')).toHaveCount(0);
  await sp.getByLabel('Close').first().click();

  await openActivities(tp);
  const prepared = tp.getByTestId('activity-picker-prepared');
  await expect(prepared).toContainText('For Jerome · from last lesson');
  const rows = prepared.locator('[data-testid="activity-picker-row"][data-prepared="1"]');
  await expect(rows).toHaveCount(5);
  await rows.first().click();
  for (const p of [tp, sp]) {
    await expect(p.getByTestId('activity-tile')).toBeVisible({ timeout: 15000 });
    await expect(p.getByTestId('activity-tile')).toContainText("Dictation: last lesson's new words");
  }
  // Marked used for the tutor.
  await openActivities(tp);
  await expect(tp.getByTestId('activity-picker-prepared')).toContainText('✓ Used');
  const list = await api<{ activities: { status: string; spec: { kind: string } }[] }>(request, `/api/relationships/${relId}/prepared-activities`, { token: tutor.token });
  expect(list.activities.filter((a) => a.status === 'used').map((a) => a.spec.kind)).toEqual(['dictation']);
});
