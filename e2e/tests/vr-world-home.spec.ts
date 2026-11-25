import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * 🥽 VR worlds — 家 Apartment (docs/VR_WORLDS.md) in the flat preview: the same pointer pipeline the
 * headset's controllers use. Dev builds expose `window.__vrWorld` (objects / panel buttons on screen,
 * the task run, the canvases' texts, moving an object by hand, standing somewhere).
 *
 * Covers: the picker lists the apartment; inspecting the remote shows 遥控器 / yáokòngqì / 一个遥控器;
 * holding the mouse on the remote picks it up (task 1); the TV's panel turns it on (task 2); a remote
 * carried over the sofa and let go rests on it (task 3), and the curtains drawn open from their panel (task 4) are checked live.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const LAUNCH = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};
test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], ...LAUNCH } });

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json' },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

interface WorldObject { id: string; x: number; y: number; visible: boolean; pos: [number, number, number]; held: boolean }
interface Target { panel: string; action: string; x: number; y: number; visible: boolean }
type Hook = {
  objects(): WorldObject[];
  targets(): Target[];
  run(): { taskIndex: number; done: string[] };
  inspected(): string | null;
  inspectTexts(): string[];
  screenOf(at: [number, number, number]): { x: number; y: number } | null;
  stand(x: number, z: number, yaw: number, pitch?: number): void;
};
type Win = { __vrWorld: Hook };

const objects = (page: Page) => page.evaluate(() => (window as unknown as Win).__vrWorld.objects());
const targets = (page: Page) => page.evaluate(() => (window as unknown as Win).__vrWorld.targets());
const run = (page: Page) => page.evaluate(() => (window as unknown as Win).__vrWorld.run());
const doneTasks = async (page: Page) => (await run(page)).done;
const inspected = (page: Page) => page.evaluate(() => (window as unknown as Win).__vrWorld.inspected());
const inspectTexts = (page: Page) => page.evaluate(() => (window as unknown as Win).__vrWorld.inspectTexts());
const screenOf = (page: Page, at: [number, number, number]) => page.evaluate((a) => (window as unknown as Win).__vrWorld.screenOf(a), at);
const stand = (page: Page, x: number, z: number, yaw: number, pitch: number) => page.evaluate(([a, b, c, d]) => (window as unknown as Win).__vrWorld.stand(a, b, c, d), [x, z, yaw, pitch] as const);

async function object(page: Page, id: string): Promise<WorldObject> {
  let o: WorldObject | undefined;
  await expect.poll(async () => {
    o = (await objects(page)).find((x) => x.id === id);
    return !!o?.visible;
  }, { timeout: 30_000, message: `${id} on screen` }).toBe(true);
  return o!;
}

async function tap(page: Page, panel: string, action: string) {
  let target: Target | undefined;
  await expect.poll(async () => {
    target = (await targets(page)).find((t) => t.visible && t.panel === panel && t.action === action);
    return !!target;
  }, { timeout: 30_000, message: `${panel} ${action}` }).toBe(true);
  await page.mouse.click(target!.x, target!.y);
}

test('VR worlds: 家 the apartment — inspect, pick up, TV, sofa, curtains', async ({ page, request }) => {
  test.setTimeout(240_000);
  const email = `vrw-home-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });

  await page.goto(`/decks?session_token=${token}`);
  await page.waitForLoadState('networkidle').catch(() => undefined);

  // The picker.
  await page.goto('/vr/worlds');
  const card = page.getByTestId('vr-world-card').filter({ hasText: 'Apartment' });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('家');
  await expect(card).toContainText('0 / 12 tasks');
  await card.getByRole('link', { name: /Preview/ }).click();
  await expect(page).toHaveURL(/\/vr\/worlds\/home$/);
  await expect(page.getByRole('note')).toContainText('Flat preview', { timeout: 60_000 });
  await page.waitForFunction(() => {
    const w = (window as unknown as { __vrWorld?: Hook }).__vrWorld;
    return !!w && w.objects().some((o) => o.id === 'sofa' && o.visible) && w.targets().some((t) => t.panel === 'hud');
  }, null, { timeout: 120_000 });
  await page.waitForTimeout(1500); // things settle

  // Stand in the living room looking at the sofa and the coffee table (the remote on it).
  const SPOT: [number, number] = [-0.4, 1.6];
  const facing = (x: number, z: number) => Math.atan2(-(x - SPOT[0]), -(z - SPOT[1]));
  await stand(page, SPOT[0], SPOT[1], facing(-2.3, 0.3), -0.45);
  await page.waitForTimeout(1000);

  // Inspect the remote: its word.
  const remote = await object(page, 'remote');
  await page.mouse.click(remote.x, remote.y);
  await expect.poll(() => inspected(page)).toBe('remote');
  await expect.poll(() => inspectTexts(page), { timeout: 15_000 }).toEqual(expect.arrayContaining(['遥控器', 'yáokòngqì', 'remote control', '一个遥控器']));
  await tap(page, 'inspect', 'close');
  await expect.poll(() => inspected(page)).toBe(null);

  // Task 1 — 拿起遥控器: hold the mouse on the remote.
  expect((await run(page)).taskIndex).toBe(0);
  const again = await object(page, 'remote');
  await page.mouse.move(again.x, again.y);
  await page.mouse.down();
  await expect.poll(() => doneTasks(page), { timeout: 20_000 }).toContain('pick_remote');
  expect((await objects(page)).find((o) => o.id === 'remote')?.held).toBe(true);

  // …and carry it over the sofa's seat (a carried thing rests over what the pointer is on), then let go.
  const seat = (await object(page, 'sofa'));
  const seatAt = await screenOf(page, [-2.45, 0.45, 0.05]);
  expect(seatAt, `${seat.id} seat on screen`).not.toBeNull();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(again.x + ((seatAt!.x - again.x) * i) / 6, again.y + ((seatAt!.y - again.y) * i) / 6);
    await page.waitForTimeout(150);
  }
  await expect.poll(async () => {
    const p = (await objects(page)).find((o) => o.id === 'remote')!.pos;
    return Math.hypot(p[0] + 2.45, p[2] - 0.05) < 0.35;
  }, { timeout: 60_000, message: 'the remote follows the pointer over the sofa' }).toBe(true);
  await page.mouse.up();

  // Task 2 — 打开电视: the TV's panel has the verb.
  await stand(page, SPOT[0], SPOT[1], facing(-2.1, 3.2), -0.25);
  const tv = await object(page, 'tv');
  await page.mouse.click(tv.x, tv.y);
  await expect.poll(async () => (await inspectTexts(page)).join('\n'), { timeout: 15_000 }).toMatch(/打开 dǎkāi · turn on/);
  await tap(page, 'inspect', 'use:power');
  await expect.poll(() => doneTasks(page), { timeout: 20_000 }).toContain('tv_on');
  await expect.poll(async () => (await inspectTexts(page)).join('\n')).toMatch(/关上 guānshang · turn off/);
  await tap(page, 'inspect', 'close');

  // Task 3 — 把遥控器放在沙发上: the remote let go over the sofa lies on its seat.
  await expect.poll(() => doneTasks(page), { timeout: 60_000 }).toContain('remote_on_sofa');

  // Task 4 — 拉开窗帘: the curtains' panel draws them open.
  await stand(page, SPOT[0], SPOT[1], facing(-3.8, 1.2), -0.15);
  const curtains = await object(page, 'curtains');
  await page.mouse.click(curtains.x, curtains.y);
  await expect.poll(async () => (await inspectTexts(page)).join('\n'), { timeout: 15_000 }).toMatch(/拉开 lākāi · draw open/);
  await tap(page, 'inspect', 'use:curtain');
  await expect.poll(() => doneTasks(page), { timeout: 20_000 }).toContain('open_curtains');
  expect((await run(page)).taskIndex).toBe(4);
});
