import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * Round 4: drag a tile onto the stage (desktop). While dragging, five drop
 * zones show (left / right / top / bottom half, whole stage) and the one under
 * the pointer lights up; dropping arranges a split. The grip's menu does the
 * same from the keyboard. And the text board leaves room for the faces box.
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

test('desktop: drag the board beside a shared screen; the keyboard menu moves tiles too', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const { tutor, student, callId } = await seedCall(request);
  const tp = await openAs(browser, tutor.token, { width: 1440, height: 900 });
  const sp = await openAs(browser, student.token, { width: 1440, height: 900 });
  await joinCall(tp, callId);
  await joinCall(sp, callId);
  await expect.poll(() => frames(sp, 'remote-video'), { timeout: 30000 }).toBeGreaterThan(0);

  // The text board leaves room at its top for the faces box (it used to cover the first lines).
  await sp.keyboard.press('b');
  await expect(sp.getByTestId('faces-pair')).toHaveAttribute('data-corner', 'tl');
  const pad = await sp.getByTestId('text-board').evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
  const pair = (await sp.getByTestId('faces-pair').boundingBox())!;
  const board = (await sp.getByTestId('text-board').boundingBox())!;
  expect(board.y + pad).toBeGreaterThanOrEqual(pair.y + pair.height);

  // The tutor shares a screen: Screen + camera for the student, the board in the rail.
  await tp.getByLabel('Share screen').click();
  const tiles = sp.getByTestId('call-tiles');
  await expect(tiles).toHaveAttribute('data-stage', 'screen', { timeout: 20000 });
  await expect(sp.getByTestId('tile-text')).toHaveAttribute('data-role', 'rail');

  // Drag the board from the rail to the right half of the stage (once the tiles have slid into place).
  await expect.poll(async () => (await box(sp, 'text'))!.width).toBeLessThan(300);
  await expect.poll(async () => (await box(sp, 'screen'))!.width).toBeGreaterThan(900);
  const rail = (await box(sp, 'text'))!;
  const stage = (await box(sp, 'screen'))!;
  await sp.mouse.move(rail.x + rail.width / 2, rail.y + rail.height - 10);
  await sp.mouse.down();
  await sp.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2, { steps: 6 });
  await expect(sp.getByTestId('drop-zone-full')).toHaveClass(/is-hot/);
  await sp.mouse.move(stage.x + stage.width - 40, stage.y + stage.height / 2, { steps: 6 });
  await expect(sp.getByTestId('drop-zone-right')).toHaveClass(/is-hot/);
  await sp.mouse.up();
  await expect(sp.getByTestId('drop-zones')).toHaveCount(0);
  await expect(tiles).toHaveAttribute('data-mode', 'split');
  await expect(tiles).toHaveAttribute('data-stage', 'screen,text');
  await expect(sp.getByTestId('split-divider')).toBeVisible();
  // The faces float over the two of them.
  await expect(sp.getByTestId('faces-pair')).toBeVisible();

  // Keyboard: the screen's grip → menu → Bottom half: the two stack.
  await sp.getByTestId('drag-screen').focus();
  await sp.keyboard.press('Enter');
  await expect(sp.getByTestId('move-menu-screen')).toBeVisible();
  await sp.getByTestId('move-screen-bottom').click();
  await expect(tiles).toHaveAttribute('data-stage', 'text,screen');
  await expect(sp.getByTestId('split-divider')).toHaveClass(/dir-column/);
  // …and Whole stage focuses it.
  await sp.getByTestId('drag-screen').click();
  await sp.getByTestId('move-screen-full').click();
  await expect(tiles).toHaveAttribute('data-mode', 'focus');
  await expect(tiles).toHaveAttribute('data-stage', 'screen');
});
