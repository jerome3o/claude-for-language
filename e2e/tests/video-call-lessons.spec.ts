/**
 * Round 4, lessons (2 Oct 2026: one lesson became four calls and three homework
 * decks). Leave keeps the call going for the other person (and Rejoin comes
 * back); End asks first and offers "Just leave"; a call started within 20
 * minutes of the last one is the same lesson — one entry in Past calls, and
 * the review page lists its calls.
 */
import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

const API = process.env.E2E_API_URL || 'http://localhost:8787';

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    // A pre-installed Chromium (e.g. remote dev containers); CI uses Playwright's own.
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  },
  permissions: ['camera', 'microphone'],
  viewport: { width: 412, height: 915 },
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
  const email = `call-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

async function openAs(browser: Browser, token: string): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1100, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`/?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  return page;
}

async function join(page: Page, callId: string) {
  await page.goto(`/calls/${callId}`);
  const button = page.getByTestId('join-call');
  await expect(button).toBeEnabled({ timeout: 20000 });
  await button.click();
  await page.getByTestId('call-live').waitFor({ timeout: 20000 });
}

test('Leave keeps the call; End confirms; the next call within 20 minutes is the same lesson', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const tutor = await seedUser(request, 'tutor', '明慧');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
  const first = await api<{ call: { id: string } }>(request, '/api/calls', { method: 'POST', token: tutor.token, data: { relationship_id: rel.data.id } });

  const tp = await openAs(browser, tutor.token);
  const sp = await openAs(browser, student.token);
  await join(tp, first.call.id);
  await join(sp, first.call.id);
  await expect(tp.getByTestId('remote-video')).toBeAttached({ timeout: 30000 });

  // ---- Jerome leaves to switch device: the call goes on for Minghui.
  await sp.getByTestId('leave-call').click();
  await sp.getByTestId('call-left').waitFor({ timeout: 10000 });
  await expect(tp.getByTestId('call-live')).toBeVisible();
  const live = await api<{ calls: { id: string; status: string }[] }>(request, `/api/calls?live=1`, { token: tutor.token });
  expect(live.calls.map((c) => c.id)).toContain(first.call.id);
  // …and rejoins.
  await sp.getByTestId('rejoin-call').click();
  await sp.getByTestId('call-live').waitFor({ timeout: 20000 });
  await expect(sp.getByTestId('remote-video')).toBeAttached({ timeout: 30000 });

  // ---- End asks first, and offers "Just leave".
  await tp.getByTestId('end-call').click();
  await expect(tp.getByTestId('end-confirm')).toBeVisible();
  await tp.getByTestId('end-confirm-end').click();
  await tp.getByTestId('call-ended').waitFor({ timeout: 10000 });
  await sp.getByTestId('call-ended').waitFor({ timeout: 10000 });

  // ---- A call right after: the same lesson.
  const second = await api<{ call: { id: string; lesson_id: string } }>(request, '/api/calls', { method: 'POST', token: student.token, data: { relationship_id: rel.data.id } });
  expect(second.call.id).not.toBe(first.call.id);
  const firstDetail = await api<{ lesson: { id: string; calls: { id: string }[] } }>(request, `/api/calls/${first.call.id}`, { token: tutor.token });
  expect(second.call.lesson_id).toBe(firstDetail.lesson.id);
  expect(firstDetail.lesson.calls.map((c) => c.id)).toEqual([first.call.id, second.call.id]);
  await api(request, `/api/calls/${second.call.id}/end`, { method: 'POST', token: student.token });

  await tp.goto('/calls');
  const lessons = tp.getByTestId('calls-lesson');
  await expect(lessons).toHaveCount(1);
  await expect(lessons.first()).toContainText('2 calls');
  await lessons.first().locator('a').first().click();
  await expect(tp.getByTestId('lesson-calls')).toContainText('One lesson, 2 calls in a row');
});
