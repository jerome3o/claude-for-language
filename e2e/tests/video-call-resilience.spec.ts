import { test, expect, APIRequestContext, Browser, Page, WebSocketRoute } from '@playwright/test';

/**
 * Video calls keep working when things go wrong (docs/VIDEO_CALLS.md "Staying connected"):
 * - the camera and microphone are blocked → the pre-join page says why and how to fix it,
 *   and the call can still be joined (to listen and watch);
 * - the room socket drops mid-call → it reconnects from the same page load, the WebRTC link
 *   is kept (the same <video> element keeps playing — no blank picture), both sides;
 * - the connection log records it and the review page shows it.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const LAUNCH = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};

test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'], ...LAUNCH },
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

async function seedPair(request: APIRequestContext): Promise<{ tutor: SeededUser; student: SeededUser; callId: string }> {
  const seed = async (tag: string, name: string) => {
    const email = `callr-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
    const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
    return { id: r.user.id, email, token: r.session_token };
  };
  const tutor = await seed('tutor', '王老师');
  const student = await seed('student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
  const call = await api<{ call: { id: string } }>(request, '/api/calls', { method: 'POST', token: tutor.token, data: { relationship_id: rel.data.id } });
  return { tutor, student, callId: call.call.id };
}

async function openAs(browser: Browser, token: string, permissions: string[] = ['camera', 'microphone']): Promise<Page> {
  const ctx = await browser.newContext({ permissions, viewport: { width: 412, height: 915 } });
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

test('blocked camera and microphone: the page explains it and the call can still be joined', async ({ playwright, browser, request }) => {
  test.setTimeout(120_000);
  const { tutor, student, callId } = await seedPair(request);
  // A browser that says no to every camera / microphone request (like a blocked site or a work policy).
  const denying = await playwright.chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream=deny'], ...LAUNCH });
  try {
    const tp = await openAs(browser, tutor.token);
    await joinCall(tp, callId);

    const sp = await openAs(denying, student.token, []);
    await sp.goto(`/calls/${callId}`);
    const card = sp.getByTestId('media-problem');
    await expect(card).toBeVisible({ timeout: 20000 });
    await expect(card).toHaveAttribute('data-problem', 'blocked');
    await expect(card).toHaveAttribute('data-device', 'both');
    await expect(card).toContainText('address bar');
    await expect(sp.getByTestId('media-retry')).toBeEnabled();
    const join = sp.getByTestId('join-call');
    await expect(join).toHaveText('Join without camera & mic');
    await join.click();
    await sp.getByTestId('call-live').waitFor({ timeout: 20000 });

    // They are in the call: the tutor's picture arrives, and the tutor sees them (no camera → initials).
    await expect(sp.getByTestId('remote-video')).toBeVisible({ timeout: 30000 });
    await expect.poll(() => sp.getByTestId('remote-video').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30000 }).toBeGreaterThan(0);
    await expect(tp.getByTestId('call-live')).toContainText('Jerome', { timeout: 20000 });
    // Turning the mic on mid-call asks again (still refused here) and says why, without leaving the call.
    await sp.getByTestId('call-mic').click();
    await expect(sp.getByTestId('media-problem')).toBeVisible();
    await expect(sp.getByTestId('call-live')).toBeVisible();
  } finally {
    await denying.close();
  }
});

test('a dropped room socket reconnects without losing the picture (same link, same video element)', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const { tutor, student, callId } = await seedPair(request);
  const tp = await openAs(browser, tutor.token);
  const sp = await openAs(browser, student.token);

  // Route the student's room socket through the test so it can be cut like a flaky Wi-Fi would.
  const sockets: WebSocketRoute[] = [];
  await sp.routeWebSocket(/\/api\/calls\/[^/]+\/ws/, (ws) => {
    ws.connectToServer();
    sockets.push(ws);
  });

  await joinCall(tp, callId);
  await joinCall(sp, callId);
  for (const p of [tp, sp]) {
    await expect.poll(() => p.getByTestId('remote-video').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30000 }).toBeGreaterThan(0);
    await expect(p.getByTestId('remote-status')).toHaveCount(0, { timeout: 20000 });
    // Mark the element: if the link were rebuilt, React would mount a fresh <video>.
    await p.getByTestId('remote-video').evaluate((v: HTMLVideoElement) => { v.dataset.mark = 'original'; });
  }
  const framesBefore = await tp.getByTestId('remote-video').evaluate((v: HTMLVideoElement) => v.getVideoPlaybackQuality().totalVideoFrames);

  // Cut the socket (the server sees it close, the page sees it drop).
  expect(sockets.length).toBe(1);
  await sockets[0].close({ code: 1006 as number, reason: 'network' }).catch(() => sockets[0].close());
  await expect.poll(() => sockets.length, { timeout: 20000 }).toBeGreaterThan(1); // reconnected with a new socket

  // The tutor saw the student's socket go and come back: the same element is still playing.
  await tp.waitForTimeout(1500);
  for (const p of [tp, sp]) {
    await expect(p.getByTestId('remote-video')).toHaveAttribute('data-mark', 'original');
    await expect(p.getByTestId('remote-status')).toHaveCount(0, { timeout: 10000 });
  }
  await expect
    .poll(() => tp.getByTestId('remote-video').evaluate((v: HTMLVideoElement) => v.getVideoPlaybackQuality().totalVideoFrames), { timeout: 10000 })
    .toBeGreaterThan(framesBefore);

  // The board still works both ways over the new socket.
  await sp.getByTestId('open-board').click();
  // Same view: the student's board opens on the tutor's screen too (a second press would close it for both).
  await expect(tp.getByTestId('call-tiles')).toHaveAttribute('data-stage', /text/, { timeout: 10000 });
  await sp.getByTestId('text-board').fill('断线以后还在');
  await expect(tp.getByTestId('text-board')).toHaveValue('断线以后还在', { timeout: 10000 });

  // End: the connection log went to the review page.
  tp.on('dialog', (d) => void d.accept());
  await tp.getByTestId('end-call').click();
  await tp.getByTestId('end-confirm-end').click(); // round 4: End asks first (a sheet, not a dialog)
  await tp.getByTestId('call-ended').waitFor({ timeout: 20000 });
  await tp.goto(`/calls/${callId}/review`);
  const log = tp.getByTestId('review-connection-log');
  await expect(log).toBeVisible({ timeout: 20000 });
  await log.locator('summary').click();
  await expect(log).toContainText('link kept');
  await expect(log).toContainText('connected');
});
