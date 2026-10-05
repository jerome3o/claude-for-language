import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * Drawing on a shared screen: the tutor shares her screen (a fake screen made
 * from a canvas — headless Chromium has no screen picker), the student draws
 * a circle and taps a point on it; the strokes arrive through the call room
 * and are painted over the tutor's own preview of her share (once she opens it
 * from the "You're sharing your screen" card), and her share bar says the
 * student is drawing.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
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
  const email = `annot-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

/** getDisplayMedia → a 1280×720 canvas "screen" with some text on it. */
function fakeScreen() {
  (navigator.mediaDevices as MediaDevices & { getDisplayMedia: unknown }).getDisplayMedia = async () => {
    const c = document.createElement('canvas');
    c.width = 1280;
    c.height = 720;
    const g = c.getContext('2d')!;
    const draw = () => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 1280, 720);
      g.fillStyle = '#111827';
      g.font = '96px sans-serif';
      g.fillText('我想要一杯咖啡', 120, 380);
      requestAnimationFrame(draw);
    };
    draw();
    return c.captureStream(10);
  };
}

async function openAs(browser: Browser, token: string, viewport: { width: number; height: number }): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport });
  await ctx.addInitScript(fakeScreen);
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

test('the student draws on the tutor\'s shared screen and the tutor sees it on her preview', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const tutor = await seedUser(request, 'tutor', '王老师');
  const student = await seedUser(request, 'student', 'Student');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
  const call = await api<{ call: { id: string } }>(request, '/api/calls', { method: 'POST', token: tutor.token, data: { relationship_id: rel.data.id } });

  const tp = await openAs(browser, tutor.token, { width: 1280, height: 800 });
  const sp = await openAs(browser, student.token, { width: 1280, height: 800 });
  await join(tp, call.call.id);
  await join(sp, call.call.id);
  await expect(tp.locator('.call-remote-label')).not.toContainText('connecting', { timeout: 30000 });

  // The tutor shares her (fake) screen.
  await tp.getByRole('button', { name: 'Share screen' }).click();
  await expect(tp.getByTestId('share-bar')).toBeVisible({ timeout: 10000 });

  // The student sees it and draws on it.
  await expect(sp.getByTestId('annot-toggle')).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => sp.getByTestId('remote-video').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 20000 }).toBeGreaterThan(0);
  await sp.getByTestId('annot-toggle').click();
  const box = (await sp.getByTestId('annot-remote').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await sp.mouse.move(cx + 80, cy);
  await sp.mouse.down();
  for (let a = 0; a <= 360; a += 20) {
    const r = (a * Math.PI) / 180;
    await sp.mouse.move(cx + 80 * Math.cos(r), cy + 50 * Math.sin(r));
  }
  await sp.mouse.up();

  // The tutor: "… is drawing on your screen", and ink on her preview of the share — her own
  // screen shows as a compact card until she asks to see it (shared/calls/share.ts).
  await expect(tp.getByTestId('share-bar')).toContainText('is drawing on your screen', { timeout: 10000 });
  await expect(tp.getByTestId('sharing-card')).toBeVisible();
  await tp.getByTestId('sharing-show').click();
  await expect.poll(async () => tp.getByTestId('annot-self').evaluate((c: HTMLCanvasElement) => {
    const g = c.getContext('2d')!;
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let inked = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) inked++;
    return inked;
  }), { timeout: 10000 }).toBeGreaterThan(20);

  // A tap is a ping, and Clear clears.
  await sp.mouse.click(cx - 100, cy - 40);
  await sp.getByRole('button', { name: 'Clear' }).click();
});
