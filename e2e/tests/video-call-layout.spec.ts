import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * The call's tile layout (shared/calls/layout.ts, components/calls/CallTiles.tsx):
 * presets, the split divider, both faces together over the board (drag to a
 * corner, tap → Speaker), the separate floating self-view snapping to corners,
 * the layout remembered on the device, phone swipes — and a shared screen
 * arriving on its own channel, so the viewer sees the screen AND the sharer's camera.
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

async function seedCall(request: APIRequestContext) {
  const seed = async (tag: string, name: string) => {
    const email = `calll-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
    const r = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
    return { email, token: r.session_token };
  };
  const tutor = await seed('tutor', '王老师');
  const student = await seed('student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
  const call = await api<{ call: { id: string } }>(request, '/api/calls', { method: 'POST', token: tutor.token, data: { relationship_id: rel.data.id } });
  return { tutor, student, callId: call.call.id };
}

async function openAs(browser: Browser, token: string, viewport: { width: number; height: number }): Promise<Page> {
  const phone = viewport.width < 640;
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport, hasTouch: phone, isMobile: false });
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

const box = (p: Page, id: string) => p.getByTestId(`tile-${id}`).boundingBox();
const frames = (p: Page, testId: string) => p.getByTestId(testId).evaluate((v: HTMLVideoElement) => v.videoWidth);

test('desktop: presets, divider, floating self-view, remembered layout, and screen + camera together', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const { tutor, student, callId } = await seedCall(request);
  const tp = await openAs(browser, tutor.token, { width: 1440, height: 900 });
  const sp = await openAs(browser, student.token, { width: 1440, height: 900 });
  await joinCall(tp, callId);
  await joinCall(sp, callId);
  await expect.poll(() => frames(sp, 'remote-video'), { timeout: 30000 }).toBeGreaterThan(0);

  // Board + camera (key 2): side by side, and the camera is still playing.
  await sp.keyboard.press('2');
  const tiles = sp.getByTestId('call-tiles');
  await expect(tiles).toHaveAttribute('data-mode', 'split');
  await expect(tiles).toHaveAttribute('data-stage', 'text,remote');
  await expect(sp.getByTestId('tile-remote')).toHaveAttribute('data-role', 'stage');
  const before = (await box(sp, 'text'))!;
  // Drag the divider to the left: the board gets narrower.
  const div = (await sp.getByTestId('split-divider').boundingBox())!;
  await sp.mouse.move(div.x + div.width / 2, div.y + div.height / 2);
  await sp.mouse.down();
  await sp.mouse.move(div.x - 300, div.y + div.height / 2, { steps: 8 });
  await sp.mouse.up();
  await expect.poll(async () => (await box(sp, 'text'))!.width).toBeLessThan(before.width - 200);

  // Focusing the board: both faces together in one box over it, top-left, their camera still playing.
  await sp.getByLabel('Focus Board').click().catch(() => sp.keyboard.press('b'));
  await expect(tiles).toHaveAttribute('data-stage', 'text');
  const pair = sp.getByTestId('faces-pair');
  await expect(pair).toHaveAttribute('data-corner', 'tl');
  await expect(sp.getByTestId('tile-remote')).toHaveAttribute('data-role', 'pair');
  await expect(sp.getByTestId('tile-self')).toHaveAttribute('data-role', 'pair');
  expect(await frames(sp, 'remote-video')).toBeGreaterThan(0);
  // Side by side (once the tiles have slid into the box), theirs first.
  await expect.poll(async () => Math.abs((await box(sp, 'remote'))!.y - (await box(sp, 'self'))!.y)).toBeLessThan(2);
  expect((await box(sp, 'remote'))!.x).toBeLessThan((await box(sp, 'self'))!.x);
  const pb = (await pair.boundingBox())!;
  expect(pb.x).toBeLessThan(40);
  // Drag the pair to the bottom-right: it snaps there, the faces inside it.
  await sp.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await sp.mouse.down();
  await sp.mouse.move(1250, 720, { steps: 10 });
  await sp.mouse.up();
  await expect(pair).toHaveAttribute('data-corner', 'br');
  await expect.poll(async () => (await box(sp, 'remote'))!.x).toBeGreaterThan(900);
  // A click (not a drag) on the pair: Speaker — their camera on the stage.
  await pair.click();
  await expect(tiles).toHaveAttribute('data-stage', 'remote');
  await expect(sp.getByTestId('tile-self')).toHaveAttribute('data-role', 'floating');
  await expect(pair).toHaveCount(0);
  // Board again: the pair comes back in its corner; Enter on it is Speaker too.
  await sp.keyboard.press('b');
  await expect(pair).toHaveAttribute('data-corner', 'br');
  await pair.focus();
  await sp.keyboard.press('Enter');
  await expect(tiles).toHaveAttribute('data-stage', 'remote');
  // Cameras: separate (layout menu) — round 2's two floating cameras over the board.
  await sp.getByTestId('open-layout').click();
  await expect(sp.getByTestId('pip-pair')).toHaveAttribute('aria-checked', 'true');
  await sp.getByTestId('pip-separate').click();
  await sp.getByTestId('open-layout').click();
  await sp.keyboard.press('b');
  await expect(tiles).toHaveAttribute('data-stage', 'text');
  await expect(sp.getByTestId('tile-remote')).toHaveAttribute('data-role', 'floating');
  await expect(pair).toHaveCount(0);

  // Drag my floating camera to the top-left corner: it snaps there.
  await expect.poll(async () => { const b = (await box(sp, 'self'))!; return b.x + b.width; }).toBeGreaterThan(1350); // settled bottom-right
  const self = (await box(sp, 'self'))!;
  await sp.mouse.move(self.x + self.width / 2, self.y + self.height / 2);
  await sp.mouse.down();
  await sp.mouse.move(120, 120, { steps: 10 });
  await sp.mouse.up();
  await expect.poll(async () => (await box(sp, 'self'))!.x).toBeLessThan(60);
  await expect.poll(async () => (await box(sp, 'self'))!.y).toBeLessThan(160);

  // The layout menu → Grid.
  await sp.getByTestId('open-layout').click();
  await sp.getByTestId('preset-grid').click();
  await expect(tiles).toHaveAttribute('data-mode', 'grid');
  await expect(sp.getByTestId('tile-self')).toHaveAttribute('data-role', 'stage');

  // Remembered on this device: leave and come back.
  await sp.reload();
  await joinCall(sp, callId);
  await expect(sp.getByTestId('call-tiles')).toHaveAttribute('data-mode', 'grid');

  // The tutor shares their screen: the student gets Screen + camera — the screen on the stage,
  // the tutor's camera floating beside it (separately: the student's remembered explicit choice),
  // both playing (a separate screen channel).
  await sp.keyboard.press('1');
  await tp.getByLabel('Share screen').click();
  await expect(sp.getByTestId('call-tiles')).toHaveAttribute('data-stage', 'screen', { timeout: 20000 });
  await expect.poll(() => frames(sp, 'remote-screen'), { timeout: 30000 }).toBeGreaterThan(0);
  await expect(sp.getByTestId('tile-remote')).toHaveAttribute('data-role', 'floating');
  await expect.poll(() => frames(sp, 'remote-video'), { timeout: 10000 }).toBeGreaterThan(0);
  // The two are different pictures (different tracks).
  const ids = await sp.evaluate(() => {
    const cam = document.querySelector('[data-testid="remote-video"]') as HTMLVideoElement;
    const scr = document.querySelector('[data-testid="remote-screen"]') as HTMLVideoElement;
    return [(cam.srcObject as MediaStream).getVideoTracks()[0]?.id, (scr.srcObject as MediaStream).getVideoTracks()[0]?.id];
  });
  expect(ids[0]).toBeTruthy();
  expect(ids[0]).not.toBe(ids[1]);
  // Cameras together again: both faces over the shared screen.
  await sp.getByTestId('open-layout').click();
  await sp.getByTestId('pip-pair').click();
  await expect(sp.getByTestId('tile-remote')).toHaveAttribute('data-role', 'pair');
  await expect(sp.getByTestId('faces-pair')).toBeVisible();
  expect(await frames(sp, 'remote-video')).toBeGreaterThan(0);
});

test('phone: the focused tile fills the screen, cameras float, swipe moves between tiles', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { tutor, student, callId } = await seedCall(request);
  const tp = await openAs(browser, tutor.token, { width: 412, height: 915 });
  const sp = await openAs(browser, student.token, { width: 412, height: 915 });
  await joinCall(tp, callId);
  await joinCall(sp, callId);
  await expect.poll(() => frames(sp, 'remote-video'), { timeout: 30000 }).toBeGreaterThan(0);
  await sp.getByTestId('open-board').click();
  const tiles = sp.getByTestId('call-tiles');
  await expect(tiles).toHaveAttribute('data-stage', 'text');
  // Both faces together, small, in a corner.
  await expect(sp.getByTestId('tile-remote')).toHaveAttribute('data-role', 'pair');
  await expect(sp.getByTestId('tile-self')).toHaveAttribute('data-role', 'pair');
  const pb = (await sp.getByTestId('faces-pair').boundingBox())!;
  expect(pb.width).toBeLessThan(220);
  expect(pb.x).toBeLessThan(40);
  // Swipe right (finger moves right) → back to the camera.
  const t = (await box(sp, 'text'))!;
  const cdp = await sp.context().newCDPSession(sp);
  const y = t.y + t.height * 0.6;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 60, y }] });
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 60 + i * 45, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(tiles).toHaveAttribute('data-stage', 'remote');
});
