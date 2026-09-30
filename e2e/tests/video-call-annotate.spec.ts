import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * Drawing on a shared screen from BOTH sides (docs/VIDEO_CALLS.md): the sharer
 * focuses their own screen and draws on it, the viewer draws on their video of
 * it; each stroke shows on both, in each person's pen colour; "Keep" (one
 * setting for both) stops the fading; Clear clears both.
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

/** How many pixels of a colour (±24 per channel) the annotation canvas holds. */
function inkCount(page: Page, testId: string, hex: string) {
  return page.getByTestId(testId).evaluate((c: HTMLCanvasElement, h: string) => {
    const ctx = c.getContext('2d')!;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && Math.abs(d[i] - r) < 24 && Math.abs(d[i + 1] - g) < 24 && Math.abs(d[i + 2] - b) < 24) n++;
    return n;
  }, hex);
}

async function drawLine(page: Page, testId: string, from: [number, number], to: [number, number]) {
  const box = (await page.getByTestId(testId).boundingBox())!;
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 12 });
  await page.mouse.up();
}

const SHARER = '#38bdf8';
const VIEWER = '#f43f5e';

test('the sharer and the viewer both draw on the shared screen; keep and clear apply to both', async ({ browser, request }) => {
  test.setTimeout(150_000);
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
  await expect.poll(() => tp.getByTestId('remote-video').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30000 }).toBeGreaterThan(0);

  // The tutor shares, then "Draw on it": their own screen fills the stage, pen on.
  await tp.getByLabel('Share screen').click();
  await tp.getByTestId('draw-on-my-screen').click();
  await expect(tp.getByTestId('call-tiles')).toHaveAttribute('data-stage', 'screen');
  await expect.poll(() => tp.getByTestId('my-screen').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 20000 }).toBeGreaterThan(0);
  await expect.poll(() => sp.getByTestId('remote-screen').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30000 }).toBeGreaterThan(0);

  // Keep drawings (for both), then the tutor circles something in blue.
  await tp.getByTestId('annot-keep').check();
  await expect(tp.getByTestId('annot-toggle')).toHaveText('✓ Done');
  await drawLine(tp, 'annot-self', [0.3, 0.3], [0.6, 0.5]);
  await expect.poll(() => inkCount(tp, 'annot-self', SHARER), { timeout: 5000 }).toBeGreaterThan(50);
  await expect.poll(() => inkCount(sp, 'annot-remote', SHARER), { timeout: 10000 }).toBeGreaterThan(50);

  // The student draws in red on their view; the tutor sees it on their screen.
  await sp.getByTestId('annot-toggle').click();
  await expect(sp.getByTestId('annot-keep')).toBeChecked(); // the tutor's setting reached them
  await drawLine(sp, 'annot-remote', [0.2, 0.7], [0.5, 0.8]);
  await expect.poll(() => inkCount(tp, 'annot-self', VIEWER), { timeout: 10000 }).toBeGreaterThan(50);

  // Kept: still there after the usual fade time.
  await tp.waitForTimeout(5500);
  expect(await inkCount(sp, 'annot-remote', SHARER)).toBeGreaterThan(50);
  expect(await inkCount(tp, 'annot-self', VIEWER)).toBeGreaterThan(50);

  // Clear clears both sides.
  await sp.getByTestId('annot-clear').click();
  await expect.poll(() => inkCount(tp, 'annot-self', SHARER), { timeout: 10000 }).toBe(0);
  await expect.poll(() => inkCount(sp, 'annot-remote', VIEWER), { timeout: 5000 }).toBe(0);
});
