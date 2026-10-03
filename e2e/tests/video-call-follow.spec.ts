import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * Calls round 5 (docs/VIDEO_CALLS.md "The tutor leads"): the camera starts ON even when an
 * older app remembered it off; opening the board shows it to the student; "Show for student"
 * pulls the student back after they looked elsewhere; the tutor stops the student's screen
 * share (and the student can't stop hers).
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const LAUNCH = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};

test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen'], ...LAUNCH },
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

async function seedPair(request: APIRequestContext) {
  const seed = async (tag: string, name: string) => {
    const email = `callf-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
    const r = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
    return { email, token: r.session_token };
  };
  const tutor = await seed('tutor', 'Minghui Wang');
  const student = await seed('student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
  const { call } = await api<{ call: { id: string } }>(request, '/api/calls', { method: 'POST', token: tutor.token, data: { relationship_id: rel.data.id } });
  return { tutor, student, callId: call.id };
}

test('camera on at join; the tutor shows the board and stops the student’s share', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const { tutor, student, callId } = await seedPair(request);
  const tp = await openAs(browser, tutor.token);
  const sp = await openAs(browser, student.token);
  // Round 4 remembered "camera off" — an old value in storage must not start the call dark.
  await tp.evaluate(() => localStorage.setItem('call-devices-v1', JSON.stringify({ camOff: true })));
  await joinCall(tp, callId);
  await joinCall(sp, callId);
  await expect(tp.getByTestId('call-cam')).toHaveAttribute('aria-label', 'Camera off');
  await expect.poll(() => sp.getByTestId('remote-video').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30000 }).toBeGreaterThan(0);
  await expect(sp.getByTestId('remote-video')).not.toHaveClass(/hidden/);

  // Opening the board shows it to the student without a button.
  await tp.getByTestId('open-board').click();
  await expect(sp.getByTestId('call-tiles')).toHaveAttribute('data-stage', /text/, { timeout: 10000 });
  await expect(sp.getByTestId('showing-banner')).toContainText('Minghui is showing you this');
  await expect(tp.getByTestId('show-text')).toContainText('Showing ✓');
  await expect(sp.getByTestId('show-text')).toHaveCount(0); // the student never leads

  // The student looks elsewhere: their choice stands …
  await sp.getByTestId('open-board').click();
  await expect(sp.getByTestId('call-tiles')).not.toHaveAttribute('data-stage', /text/);
  await expect(sp.getByTestId('showing-banner')).toHaveCount(0);
  await sp.waitForTimeout(1500);
  await expect(sp.getByTestId('call-tiles')).not.toHaveAttribute('data-stage', /text/);
  // … until the tutor shows it again.
  await tp.getByTestId('show-text').click();
  await expect(sp.getByTestId('call-tiles')).toHaveAttribute('data-stage', /text/, { timeout: 10000 });
  await expect(sp.getByTestId('showing-banner')).toBeVisible();

  // The student shares; only the tutor gets "Stop their share".
  await sp.getByLabel('Share screen').click();
  await expect(sp.getByTestId('share-bar')).toBeVisible({ timeout: 15000 });
  await expect(tp.getByTestId('stop-their-share')).toBeVisible({ timeout: 20000 });
  await expect(sp.getByTestId('stop-their-share')).toHaveCount(0);
  await tp.getByTestId('stop-their-share').click();
  await expect(sp.getByTestId('share-stopped-note')).toContainText('Minghui stopped your screen share', { timeout: 10000 });
  await expect(sp.getByTestId('share-bar')).toHaveCount(0);
  await expect(tp.getByTestId('stop-their-share')).toHaveCount(0, { timeout: 10000 });
  await sp.getByLabel('Share screen').waitFor();
});
