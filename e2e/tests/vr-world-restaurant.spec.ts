import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * 🥽 VR worlds — 饭馆 the restaurant (docs/VR_WORLDS.md) in the flat preview. Dev builds expose
 * `window.__vrWorld` (where each object / panel button is on screen, the task run, the canvases'
 * texts, moving an object by hand, opening an object's panel).
 *
 * Covers: the picker lists the restaurant; inspecting the teapot shows 茶壶 / cháhú / teapot / 一把茶壶;
 * holding the mouse on it picks it up (task 1); the engine sees it resting on the lazy Susan (task 2);
 * the lazy Susan's panel turns it (task 3, a state) and the fan's panel switches it on (task 4); the
 * picker remembers 4 of 11.
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
  inspect(id: string): void;
  inspected(): string | null;
  inspectTexts(): string[];
  place(id: string, at: [number, number, number]): void;
};
type Win = { __vrWorld: Hook };

const objects = (page: Page) => page.evaluate(() => (window as unknown as Win).__vrWorld.objects());
const targets = (page: Page) => page.evaluate(() => (window as unknown as Win).__vrWorld.targets());
const run = (page: Page) => page.evaluate(() => (window as unknown as Win).__vrWorld.run());
const inspected = (page: Page) => page.evaluate(() => (window as unknown as Win).__vrWorld.inspected());
const inspectTexts = (page: Page) => page.evaluate(() => (window as unknown as Win).__vrWorld.inspectTexts());
const inspect = (page: Page, id: string) => page.evaluate((i) => (window as unknown as Win).__vrWorld.inspect(i), id);
const place = (page: Page, id: string, at: [number, number, number]) => page.evaluate(([i, a]) => (window as unknown as Win).__vrWorld.place(i as string, a as [number, number, number]), [id, at] as const);
const doneIds = async (page: Page) => (await run(page)).done;

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
    const list = await targets(page);
    target = list.find((t) => t.visible && t.panel === panel && t.action === action);
    return !!target;
  }, { timeout: 20_000, message: `${panel} ${action}` }).toBe(true);
  await page.mouse.click(target!.x, target!.y);
}

/** Taps a verb on the inspect panel until the task is done (the panel may still be easing into place). */
async function useUntil(page: Page, action: string, task: string) {
  await expect(async () => {
    if (!(await doneIds(page)).includes(task)) await tap(page, 'inspect', action);
    await expect.poll(() => doneIds(page), { timeout: 4_000 }).toContain(task);
  }).toPass({ timeout: 40_000 });
}

test('VR worlds: the restaurant — inspect, pick up, the lazy Susan, the fan', async ({ page, request }) => {
  test.setTimeout(240_000);
  const email = `vrr-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });

  await page.goto(`/decks?session_token=${token}`);
  await page.waitForLoadState('networkidle').catch(() => undefined);

  // The picker lists the restaurant.
  await page.goto('/vr/worlds');
  const card = page.getByTestId('vr-world-card').filter({ hasText: '饭馆' });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('0 / 11 tasks');
  await card.getByRole('link', { name: /Preview/ }).click();
  await expect(page).toHaveURL(/\/vr\/worlds\/restaurant$/);
  await expect(page.getByRole('note')).toContainText('Flat preview', { timeout: 60_000 });
  await page.waitForFunction(() => {
    const w = (window as unknown as { __vrWorld?: Hook }).__vrWorld;
    return !!w && w.objects().some((o) => o.id === 'teapot' && o.visible) && w.targets().some((t) => t.panel === 'hud');
  }, null, { timeout: 120_000 });
  await page.waitForTimeout(1500); // things settle on the tables

  // Nothing fell off a table while settling (small things on the round table, the bill).
  const settled = await objects(page);
  for (const id of ['rest', 'rest_2', 'bill', 'teacup', 'spoon', 'chopsticks']) {
    expect(settled.find((o) => o.id === id)?.pos[1], `${id} stays on its table`).toBeGreaterThan(0.7);
  }

  // Inspect the teapot (a click on it): its word and measure word.
  const teapot = await object(page, 'teapot');
  await page.mouse.click(teapot.x, teapot.y);
  await expect.poll(() => inspected(page)).toBe('teapot');
  await expect.poll(() => inspectTexts(page), { timeout: 10_000 }).toEqual(expect.arrayContaining(['茶壶', 'cháhú', 'teapot', '一把茶壶']));
  // The panel eases into place beside the teapot: tap ✕ again until it has closed.
  await expect(async () => {
    await tap(page, 'inspect', 'close');
    await expect.poll(() => inspected(page), { timeout: 3_000 }).toBe(null);
  }).toPass({ timeout: 30_000 });

  // Task 1 — 拿起茶壶: hold the mouse on it.
  expect((await run(page)).taskIndex).toBe(0);
  const pot = await object(page, 'teapot');
  await page.mouse.move(pot.x, pot.y);
  await page.mouse.down();
  await expect.poll(() => doneIds(page), { timeout: 15_000 }).toContain('pick_teapot');
  await page.mouse.up();

  // Task 2 — 把茶壶放在转盘上: the engine sees it resting on the lazy Susan.
  await expect(async () => {
    await place(page, 'teapot', [-0.86, 0.9, -0.2]);
    await expect.poll(() => doneIds(page), { timeout: 8_000 }).toContain('teapot_on_susan');
  }).toPass({ timeout: 45_000 });

  // Task 3 — 转一下转盘: the lazy Susan's panel has the verb 转.
  await inspect(page, 'lazy_susan');
  await expect.poll(async () => (await inspectTexts(page)).join('\n'), { timeout: 10_000 }).toMatch(/转 zhuàn · turn/);
  await useUntil(page, 'use:spin', 'turn_susan');
  await expect.poll(async () => (await inspectTexts(page)).join('\n')).toMatch(/停下 tíngxia · stop/);

  // Task 4 — 太热了，把电扇打开: the fan's panel switches it on.
  await inspect(page, 'fan');
  await expect.poll(async () => (await inspectTexts(page)).join('\n'), { timeout: 10_000 }).toMatch(/电扇/);
  await useUntil(page, 'use:power', 'fan_on');
  expect((await run(page)).taskIndex).toBe(4);

  // The picker remembers it (the device's IndexedDB `vr-worlds`).
  await page.waitForTimeout(1000);
  await page.goto('/vr/worlds');
  await expect(page.getByTestId('vr-world-card').filter({ hasText: '饭馆' })).toContainText('4 / 11 tasks', { timeout: 20_000 });
});
