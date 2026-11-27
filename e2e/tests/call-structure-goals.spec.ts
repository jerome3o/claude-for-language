import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';
import { pressJoin } from './fixtures/calls';

/**
 * 🎯 Structures to use in a video call (shared/calls/goals.ts, docs/VIDEO_CALLS.md "Structures to use";
 * Jerome, Nov 2026: "a few sentence structures I should be trying to use … ticked off when used naturally").
 *
 * Two browsers in one relationship call. The student finished mini lessons teaching 除了…还…, 本来…要… and
 * 从…的角度来看 this week: the call opens with them, the panel opens by itself on his page only. Hermetic:
 * no real Soniox — the student's page sets `window.__callGoalsTest` and says lines through
 * `window.__callGoalsSay(text)` (the stand-in transcript feed of hooks/useCallGoals.ts); the model check
 * is the worker's E2E stand-in (a sentence with 随便 is "not the structure"). A sentence that uses one
 * ticks it for both (✓ + the sentence + the goal chime), a near miss stays unticked with its sentence,
 * the tutor ticks one by hand, the student adds 一…就…, and the review page lists what he used.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  },
});

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function seedUser(request: APIRequestContext, tag: string, name: string): Promise<SeededUser> {
  const email = `goals-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

const pattern = (name: string, pieces: Array<{ hanzi?: string; slot?: string }>, meaning: string, example: string) => ({
  title: name,
  sections: [{ exercises: [{ type: 'note', patterns: [{ name, pieces, meaning, examples: [{ hanzi: example }] }] }] }],
});

/** Mini lessons he finished `daysAgo` days ago. */
async function finishLesson(request: APIRequestContext, token: string, spec: unknown, daysAgo: number) {
  const r = await api<{ lesson?: { id: string }; id?: string }>(request, '/api/custom-lessons', { method: 'POST', token, data: { spec } });
  const id = r.lesson?.id ?? r.id!;
  const at = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  await api(request, '/api/custom-lessons/offline-complete', { method: 'POST', token, data: { events: [{ id: `done-${id}`, lesson_id: id, correct: 3, total: 3, completed_at: at }] } });
}

async function openAs(browser: Browser, token: string, student: boolean): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((isStudent) => {
    const w = window as unknown as { __callChimes: string[]; __callGoalsTest?: boolean };
    w.__callChimes = [];
    if (isStudent) w.__callGoalsTest = true;
  }, student);
  const page = await ctx.newPage();
  await page.goto(`/?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  return page;
}

async function join(page: Page, callId: string) {
  await page.goto(`/calls/${callId}`);
  await expect(page.getByTestId('join-call')).toBeEnabled({ timeout: 20000 });
  await page.getByTestId('record-toggle').uncheck();
  await pressJoin(page);
}

const say = (page: Page, text: string) => page.evaluate((t) => (window as unknown as { __callGoalsSay: (t: string) => void }).__callGoalsSay(t), text);
const chimes = (page: Page) => page.evaluate(() => (window as unknown as { __callChimes: string[] }).__callChimes.slice());
const goalRow = (page: Page, name: string) => page.getByTestId('call-goals-panel').locator('li.call-goal').filter({ hasText: name });

test('structures to use: picked from his lessons, ticked from his speech, by hand, and in the review', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const tutor = await seedUser(request, 'tutor', '明慧 Minghui');
  const student = await seedUser(request, 'student', 'Jerome Swannack');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
  await finishLesson(request, student.token, pattern('除了…还…', [{ hanzi: '除了' }, { slot: 'Noun' }, { hanzi: '，' }, { slot: 'Subject' }, { hanzi: '还' }, { slot: 'Verb' }], 'besides A, also B', '除了中文，我还学日语。'), 2);
  await finishLesson(request, student.token, pattern('本来…要…', [{ hanzi: '本来' }, { slot: 'Subject' }, { hanzi: '要' }, { slot: 'Verb' }], 'originally meant to', '我本来要去，后来没去。'), 4);
  await finishLesson(request, student.token, pattern('从…的角度来看', [{ hanzi: '从' }, { slot: 'Noun' }, { hanzi: '的角度来看' }], 'from the point of view of', '从老师的角度来看，这样不好。'), 6);
  const call = await api<{ call: { id: string } }>(request, '/api/calls', { method: 'POST', token: tutor.token, data: { relationship_id: rel.data.id } });

  const tp = await openAs(browser, tutor.token, false);
  const sp = await openAs(browser, student.token, true);
  await join(tp, call.call.id);
  await join(sp, call.call.id);

  // His page opens the panel by itself, newest first; hers shows the chip only.
  const panel = sp.getByTestId('call-goals-panel');
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(panel.locator('li.call-goal .call-goal-name')).toHaveText(['除了…还…', '本来…要…', '从…的角度来看']);
  await expect(sp.getByTestId('call-goals-listen')).toContainText('Listening');
  await expect(tp.getByTestId('call-goals-chip')).toHaveText('🎯 0/3');
  await expect(tp.getByTestId('call-goals-panel')).toHaveCount(0);
  // He can't tick by hand.
  await expect(panel.getByTestId('call-goal-tick-0')).toHaveCount(0);

  // He uses one in the conversation: ✓ with the sentence, on both pages, with the goal chime.
  await say(sp, '除了中文，我还学日语。');
  await expect(goalRow(sp, '除了…还…')).toHaveAttribute('data-status', 'used', { timeout: 15_000 });
  await expect(goalRow(sp, '除了…还…')).toContainText('除了中文，我还学日语。');
  await expect(tp.getByTestId('call-goals-chip')).toHaveText('🎯 1/3', { timeout: 15_000 });
  await tp.getByTestId('call-goals-chip').click();
  await expect(goalRow(tp, '除了…还…')).toContainText('“除了中文，我还学日语。”');
  await expect.poll(() => chimes(tp)).toContain('goal');
  await expect.poll(() => chimes(sp)).toContain('goal');

  // A sentence with the words that isn't the structure: a near miss, not ticked.
  await say(sp, '本来我就是随便要说说');
  await expect(goalRow(sp, '本来…要…')).toHaveAttribute('data-status', 'near', { timeout: 15_000 });
  await expect(goalRow(sp, '本来…要…')).toContainText('随便');
  // Words that don't match at all do nothing.
  await say(sp, '我今天很忙。');
  await expect(goalRow(sp, '从…的角度来看')).toHaveAttribute('data-status', 'open');

  // The tutor ticks one by hand; he sees who ticked it.
  await goalRow(tp, '从…的角度来看').getByRole('button', { name: '✓ Tick' }).click();
  await expect(goalRow(sp, '从…的角度来看')).toContainText('ticked by 明慧', { timeout: 15_000 });
  await expect(sp.getByTestId('call-goals-chip')).toHaveText('🎯 2/3');

  // He adds one to aim for; both see it, and using it ticks it.
  await sp.getByTestId('call-goals-input').fill('一…就…');
  await sp.getByTestId('call-goals-add').click();
  await expect(goalRow(tp, '一…就…')).toBeVisible({ timeout: 15_000 });
  await expect(goalRow(sp, '一…就…')).toBeVisible({ timeout: 15_000 });
  await say(sp, '我一到家就睡觉了。');
  await expect(goalRow(sp, '一…就…')).toHaveAttribute('data-status', 'used', { timeout: 15_000 });
  await expect(goalRow(tp, '一…就…')).toHaveAttribute('data-status', 'used', { timeout: 15_000 });
  await expect(tp.getByTestId('call-goals-chip')).toHaveText('🎯 3/4');

  // The call ends: the review page lists what he used.
  await tp.getByTestId('end-call').click();
  await tp.getByTestId('end-confirm-end').click();
  await sp.goto(`/calls/${call.call.id}/review`);
  const review = sp.getByTestId('review-goals');
  await expect(review).toBeVisible({ timeout: 30_000 });
  await expect(review).toContainText('3 of 4 used');
  await expect(review).toContainText('除了中文，我还学日语。');
  await expect(review).toContainText('Close, not quite');
});
