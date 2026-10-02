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

/** The canvas's box once it has stopped moving (a tile slides onto the stage with a transition). */
async function settledBox(page: Page, testId: string) {
  let last = '';
  for (let i = 0; i < 40; i++) {
    const b = (await page.getByTestId(testId).boundingBox())!;
    const key = `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}`;
    if (key === last) return b;
    last = key;
    await page.waitForTimeout(100);
  }
  return (await page.getByTestId(testId).boundingBox())!;
}

/** Wait until the start point really hits the (interactive) canvas — not a tile still sliding, not a layer that ignores the pointer. */
async function settledTarget(page: Page, testId: string, at: [number, number]) {
  for (let i = 0; i < 50; i++) {
    const box = await settledBox(page, testId);
    const hit = await page.getByTestId(testId).evaluate((c: HTMLElement, p: { x: number; y: number }) => {
      const el = document.elementFromPoint(p.x, p.y);
      return el === c && getComputedStyle(c).pointerEvents !== 'none';
    }, { x: box.x + box.width * at[0], y: box.y + box.height * at[1] });
    if (hit) return box;
    await page.waitForTimeout(100);
  }
  throw new Error(`${testId} never became the target under the pointer`);
}

async function drawLine(page: Page, testId: string, from: [number, number], to: [number, number]) {
  const box = await settledTarget(page, testId, from);
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

  // Keep drawings is ON by default (round 4) — nothing fades unexpectedly. The tutor circles something in blue.
  await expect(tp.getByTestId('annot-keep')).toBeChecked();
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

  // ---- Round 4: TEXT on the shared screen. The student types Chinese (a real IME composition) in red.
  await sp.getByTestId('annot-tool-text').click();
  const canvas = (await sp.getByTestId('annot-remote').boundingBox())!;
  await sp.mouse.click(canvas.x + canvas.width * 0.35, canvas.y + canvas.height * 0.4);
  const editor = sp.getByTestId('annot-text-editor');
  await expect(editor).toBeFocused();
  const cdp = await sp.context().newCDPSession(sp);
  await cdp.send('Input.imeSetComposition', { selectionStart: 2, selectionEnd: 2, text: 'ba' });
  await cdp.send('Input.insertText', { text: '把字句' });
  await sp.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
  // It reaches the tutor's screen, in the student's colour.
  await expect.poll(() => inkCount(tp, 'annot-self', VIEWER), { timeout: 10000 }).toBeGreaterThan(30);
  await expect.poll(() => inkCount(sp, 'annot-remote', VIEWER), { timeout: 5000 }).toBeGreaterThan(30);

  // Kept: the student reloads and rejoins — the room gives the text back.
  await joinCall(sp, call.id);
  await expect.poll(() => sp.getByTestId('remote-screen').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30000 }).toBeGreaterThan(0);
  await expect.poll(() => inkCount(sp, 'annot-remote', VIEWER), { timeout: 10000 }).toBeGreaterThan(30);

  // Tap the text: selected (✕); ✕ deletes it for both.
  await sp.getByTestId('annot-toggle').click();
  await sp.getByTestId('annot-tool-text').click();
  const c2 = (await sp.getByTestId('annot-remote').boundingBox())!;
  await sp.mouse.click(c2.x + c2.width * 0.35 + 12, c2.y + c2.height * 0.4 - 4);
  await sp.getByTestId('annot-text-delete').click();
  await expect.poll(() => inkCount(tp, 'annot-self', VIEWER), { timeout: 10000 }).toBe(0);
  await expect.poll(() => inkCount(sp, 'annot-remote', VIEWER), { timeout: 5000 }).toBe(0);
});
