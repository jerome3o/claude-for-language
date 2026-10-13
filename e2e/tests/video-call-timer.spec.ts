import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * The call timer and call sounds (shared/calls/timer.ts, shared/calls/chime.ts — Minghui, Oct 2026:
 * "I sometimes need to time students' tests"; a sound when someone joins).
 *
 * Two browsers in one relationship call: the student joining shows "Jerome joined" on the tutor's
 * page with the join chime; the tutor sets a short countdown and both pages show it counting; the
 * student can't run it; at zero both pages say "Time's up" and play the timer bell once; the
 * student leaving shows "Jerome left" after the grace. Chimes are counted through the page's
 * `window.__callChimes` seam (services/calls/callSounds.ts).
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
  const email = `timer-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

async function openAs(browser: Browser, token: string): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { (window as unknown as { __callChimes: string[] }).__callChimes = []; });
  const page = await ctx.newPage();
  await page.goto(`/?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  return page;
}

async function join(page: Page, callId: string) {
  await page.goto(`/calls/${callId}`);
  await expect(page.getByTestId('join-call')).toBeEnabled({ timeout: 20000 });
  await page.getByTestId('record-toggle').uncheck();
  await page.getByTestId('join-call').click();
  await page.getByTestId('call-live').waitFor({ timeout: 20000 });
}

const chimes = (page: Page) => page.evaluate(() => (window as unknown as { __callChimes: string[] }).__callChimes.slice());

test('the tutor times a test: both see the countdown, the bell rings once at zero; joins and leaves chime', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const tutor = await seedUser(request, 'tutor', '明慧 Minghui');
  const student = await seedUser(request, 'student', 'Jerome Swannack');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
  const call = await api<{ call: { id: string } }>(request, '/api/calls', { method: 'POST', token: tutor.token, data: { relationship_id: rel.data.id } });

  const tp = await openAs(browser, tutor.token);
  const sp = await openAs(browser, student.token);
  await join(tp, call.call.id);
  await join(sp, call.call.id);

  // The tutor hears and sees him join; his own join is silent.
  await expect(tp.getByTestId('presence-toast-join')).toContainText('Jerome joined', { timeout: 20000 });
  expect(await chimes(tp)).toEqual(['join']);
  expect(await chimes(sp)).toEqual([]);

  // Only the tutor has the timer button; the student sees nothing until a timer is set.
  await expect(sp.getByTestId('call-timer-pill')).toHaveCount(0);
  await tp.getByTestId('call-timer-pill').click();
  await expect(tp.getByTestId('timer-preset-5')).toContainText('5 min');
  await tp.getByTestId('timer-custom').fill('0:06');
  await expect(tp.getByTestId('timer-custom-start')).toContainText('6 s');
  await tp.getByTestId('timer-custom-start').click();

  // Both pages count down.
  await expect(tp.getByTestId('call-timer-time')).toHaveText(/^0:0[3-6]$/, { timeout: 5000 });
  await expect(sp.getByTestId('call-timer-time')).toHaveText(/^0:0[2-6]$/, { timeout: 10000 });
  // The student's panel is read-only.
  await sp.getByTestId('call-timer-pill').click();
  await expect(sp.getByTestId('call-timer-panel')).toContainText('Only your tutor can start or stop it');
  await expect(sp.getByTestId('timer-pause')).toHaveCount(0);

  // Zero: "Time's up" on both pages, the bell once each.
  await expect(tp.getByTestId('timer-up-toast')).toBeVisible({ timeout: 15000 });
  await expect(sp.getByTestId('timer-up-toast')).toBeVisible({ timeout: 15000 });
  await expect(tp.getByTestId('call-timer-time')).toHaveText('Time’s up');
  expect((await chimes(tp)).filter((c) => c === 'timer')).toHaveLength(1);
  expect((await chimes(sp)).filter((c) => c === 'timer')).toHaveLength(1);

  // A stopwatch: set, pause, the student sees it paused.
  await tp.getByTestId('call-timer-pill').click();
  await tp.getByTestId('timer-new').click();
  await tp.getByTestId('timer-mode-stopwatch').click();
  await tp.getByTestId('timer-stopwatch-start').click();
  await expect(sp.getByTestId('call-timer-time')).toHaveText(/^0:0[0-9]$/, { timeout: 10000 });
  await tp.getByTestId('call-timer-pill').click();
  await tp.getByTestId('timer-pause').click();
  await expect(sp.getByTestId('call-timer-pill')).toHaveClass(/paused/, { timeout: 10000 });
  await tp.getByTestId('timer-clear').click();
  await expect(sp.getByTestId('call-timer-pill')).toHaveCount(0, { timeout: 10000 });

  // Call sounds off on the tutor's page: the toast still shows, no chime.
  await tp.getByRole('button', { name: 'More' }).click();
  await tp.getByTestId('menu-sounds').click();
  // He leaves: "Jerome left" after the grace.
  await sp.getByTestId('leave-call').click();
  await expect(tp.getByTestId('presence-toast-leave')).toContainText('Jerome left', { timeout: 20000 });
  expect(await chimes(tp)).toEqual(['join', 'timer']);
});
