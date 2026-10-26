import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * 🥽 VR (beta, docs/VR.md) in the flat preview — what every browser without immersive WebXR shows,
 * and the same pointer pipeline the headset's controllers use: a click on the canvas is a ray from
 * the camera, raycast against the windows, hit-tested on the panel. The dev build's `window.__vr`
 * says where each tap target is on screen (only visible ones are clicked).
 *
 * Covers: the page loads (flat preview note), the Study window studies a card (Show answer →
 * Good writes a real review event to IndexedDB), a Chinese word opens the explorer window, a
 * window closes from its bar, and the tray opens Homework.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

// WebGL in headless Chromium: the software rasteriser. PW_CHROMIUM_PATH: a local Chromium (remote sessions).
const LAUNCH = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};
test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], ...LAUNCH } });

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

interface Target { panel: string; action: string; x: number; y: number; visible: boolean }

const targets = (page: Page) => page.evaluate(() => (window as unknown as { __vr: { targets(): Target[] } }).__vr.targets());
const windows = (page: Page) => page.evaluate(() => (window as unknown as { __vr: { windows(): Array<{ id: string; kind: string }> } }).__vr.windows());

async function findTarget(page: Page, panel: string, action: string | RegExp): Promise<Target | null> {
  const list = await targets(page);
  return list.find((t) => t.visible && t.panel.startsWith(panel) && (typeof action === 'string' ? t.action === action : action.test(t.action))) ?? null;
}

async function tap(page: Page, panel: string, action: string | RegExp) {
  let target: Target | null = null;
  await expect.poll(async () => (target = await findTarget(page, panel, action)) !== null, { timeout: 20_000, message: `${panel} ${action}` }).toBe(true);
  await page.mouse.click(target!.x, target!.y);
}

test('VR flat preview: study a card, explore a word, move between windows', async ({ page, request }) => {
  test.setTimeout(150_000);
  const email = `vr-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'VR 银行' } });
  await api(request, `/api/decks/${deck.id}/notes`, { method: 'POST', token, data: { hanzi: '银行', pinyin: 'yínháng', english: 'bank' } });

  // Sign in and let the sync bring the deck down.
  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('VR 银行').first()).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => localStorage.removeItem('vr-windows-v1'));

  await page.goto('/vr');
  await expect(page.getByRole('note')).toContainText('Flat preview', { timeout: 30_000 });
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => {
    const vr = (window as unknown as { __vr?: { targets(): Array<{ panel: string }> } }).__vr;
    return !!vr && vr.targets().some((t) => t.panel === 'tray');
  }, null, { timeout: 60_000 });
  expect((await windows(page)).map((w) => w.kind)).toEqual(['study']);

  // The session may be built before the cards are on the device: "↻ Check again" until the card shows.
  await expect(async () => {
    const reveal = await findTarget(page, 'win:study', 'reveal');
    if (!reveal) {
      const again = await findTarget(page, 'win:study', 'reload');
      if (again) await page.mouse.click(again.x, again.y);
    }
    expect(await findTarget(page, 'win:study', 'reveal')).not.toBeNull();
  }).toPass({ timeout: 45_000 });

  const reviews = () => page.evaluate(() => new Promise<number>((resolve) => {
    const open = indexedDB.open('ChineseLearningDB');
    open.onsuccess = () => {
      const tx = open.result.transaction('reviewEvents', 'readonly');
      const req = tx.objectStore('reviewEvents').count();
      req.onsuccess = () => { resolve(req.result); open.result.close(); };
      req.onerror = () => resolve(-1);
    };
    open.onerror = () => resolve(-1);
  }));
  const before = await reviews();

  // Show answer; a Chinese word on the card opens the explorer window, where a character goes deeper.
  await tap(page, 'win:study', 'reveal');
  await tap(page, 'win:study', 'explore:银行');
  await expect.poll(async () => (await windows(page)).map((w) => w.kind).sort(), { timeout: 15_000 }).toEqual(['explorer', 'study']);
  await tap(page, 'win:explorer', 'push:银');
  await expect.poll(async () => (await findTarget(page, 'win:explorer', 'pop')) !== null, { timeout: 15_000 }).toBe(true);

  // Close it from its bar; back at the card, Good writes the same review event as the web session.
  await tap(page, 'bar:explorer', 'close');
  await expect.poll(async () => (await windows(page)).map((w) => w.kind), { timeout: 15_000 }).toEqual(['study']);
  await tap(page, 'win:study', 'rate:2');
  await expect.poll(reviews, { timeout: 15_000 }).toBe(before + 1);

  // The tray opens Homework.
  await tap(page, 'tray', 'open:homework');
  await expect.poll(async () => (await windows(page)).map((w) => w.kind).sort(), { timeout: 15_000 }).toEqual(['homework', 'study']);

  // Windows are remembered per device.
  await page.reload();
  await page.waitForFunction(() => !!(window as unknown as { __vr?: unknown }).__vr, null, { timeout: 60_000 });
  await expect.poll(async () => (await windows(page)).map((w) => w.kind).sort(), { timeout: 15_000 }).toEqual(['homework', 'study']);
});
