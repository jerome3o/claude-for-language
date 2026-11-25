import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * 🥽 VR world 菜市场 (the wet market, frontend/src/vr/worlds/market) in the flat preview — the same
 * pointer pipeline a headset's controllers use. Dev builds expose `window.__vrWorld` (docs/VR_WORLDS.md
 * "Running it / screenshots").
 *
 * Covers: the picker lists the market; inspecting a tomato shows 西红柿 / xīhóngshì / tomato / 一个西红柿;
 * holding the mouse on a tomato picks it up (task 1); the watermelon resting on the electronic scale
 * (task 2) and two tomatoes in the plastic bag (task 3) are checked live; the fan's panel turns it on
 * (task 4); the picker remembers 4 / 11.
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
  place(id: string, at: [number, number, number]): void;
};
type Win = { __vrWorld: Hook };

const objects = (page: Page) => page.evaluate(() => (window as unknown as Win).__vrWorld.objects());
const targets = (page: Page) => page.evaluate(() => (window as unknown as Win).__vrWorld.targets());
const run = (page: Page) => page.evaluate(() => (window as unknown as Win).__vrWorld.run());
const inspected = (page: Page) => page.evaluate(() => (window as unknown as Win).__vrWorld.inspected());
const inspectTexts = (page: Page) => page.evaluate(() => (window as unknown as Win).__vrWorld.inspectTexts());
const place = (page: Page, id: string, at: [number, number, number]) => page.evaluate(([i, a]) => (window as unknown as Win).__vrWorld.place(i as string, a as [number, number, number]), [id, at] as const);

/** The first of `ids` on screen (some sit behind others from the spawn point). */
async function anyVisible(page: Page, ids: string[]): Promise<WorldObject> {
  let o: WorldObject | undefined;
  await expect.poll(async () => {
    o = (await objects(page)).find((x) => ids.includes(x.id) && x.visible);
    return !!o;
  }, { timeout: 20_000, message: `one of ${ids.join(', ')} on screen` }).toBe(true);
  return o!;
}

/**
 * Moves things by hand until the engine sees the task done. A placement can be undone by a re-render
 * that lands before the physics step syncs it (likelier at swiftshader's few frames a second), so it
 * is repeated, at the things' resting heights (nothing falls, nothing bounces).
 */
async function placeUntilDone(page: Page, places: Array<[string, [number, number, number]]>, task: string) {
  await expect.poll(async () => {
    if ((await run(page)).done.includes(task)) return true;
    for (const [id, at] of places) await place(page, id, at);
    await page.waitForTimeout(1500);
    return (await run(page)).done.includes(task);
  }, { timeout: 150_000, intervals: [300], message: `task ${task}` }).toBe(true);
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

test('VR worlds: the wet market — inspect, pick up, weigh, bag, the fan', async ({ page, request }) => {
  test.setTimeout(480_000);
  const email = `vrm-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });

  await page.goto(`/decks?session_token=${token}`);
  await page.waitForLoadState('networkidle').catch(() => undefined);

  // The picker lists the market.
  await page.goto('/vr/worlds');
  const card = page.getByTestId('vr-world-card').filter({ hasText: '菜市场' });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('0 / 11 tasks');
  await card.getByRole('link', { name: /Preview/ }).click();
  await expect(page).toHaveURL(/\/vr\/worlds\/market$/);
  await expect(page.getByRole('note')).toContainText('Flat preview', { timeout: 60_000 });
  await page.waitForFunction(() => {
    const w = (window as unknown as { __vrWorld?: Hook }).__vrWorld;
    return !!w && w.objects().some((o) => o.id.startsWith('tomato') && o.visible) && w.targets().some((t) => t.panel === 'hud');
  }, null, { timeout: 120_000 });
  await page.waitForTimeout(1500); // things settle on the stalls

  // Inspect a tomato: its word and measure word.
  const tomatoes = ['tomato', 'tomato_2', 'tomato_3'];
  const t1 = await anyVisible(page, tomatoes);
  await page.mouse.click(t1.x, t1.y);
  await expect.poll(() => inspected(page)).toBe(t1.id);
  await expect.poll(() => inspectTexts(page), { timeout: 10_000 }).toEqual(expect.arrayContaining(['西红柿', 'xīhóngshì', 'tomato', '一个西红柿']));
  await tap(page, 'inspect', 'close');
  await expect.poll(() => inspected(page)).toBe(null);

  // Task 1 — 拿起一个西红柿: hold the mouse on a tomato.
  expect((await run(page)).taskIndex).toBe(0);
  const t2 = await anyVisible(page, tomatoes);
  await page.mouse.move(t2.x, t2.y);
  await page.mouse.down();
  await expect.poll(async () => (await run(page)).done, { timeout: 20_000 }).toContain('pick_tomato');
  expect((await objects(page)).find((o) => o.id === t2.id)?.held).toBe(true);
  await page.mouse.up();

  // Task 2 — 把西瓜放在电子秤上: the watermelon resting on the scale's pan (placed at its resting height).
  await placeUntilDone(page, [['watermelon', [1.63, 1.022, -0.25]]], 'melon_on_scale');

  // Task 3 — 把两个西红柿放进塑料袋里: two tomatoes lying on the bag's floor.
  await placeUntilDone(page, [['tomato', [-1.69, 0.905, -0.05]], ['tomato_2', [-1.59, 0.905, -0.05]]], 'tomatoes_in_bag');

  // Task 4 — 太热了，打开电风扇: the fan's panel has the verb.
  const fan = await anyVisible(page, ['fan']);
  await page.mouse.click(fan.x, fan.y);
  await expect.poll(async () => (await inspectTexts(page)).join('\n'), { timeout: 10_000 }).toMatch(/打开 dǎkāi · turn on/);
  await tap(page, 'inspect', 'use:power');
  await expect.poll(async () => (await run(page)).done, { timeout: 20_000 }).toContain('fan_on');
  await expect.poll(async () => (await inspectTexts(page)).join('\n')).toMatch(/关上 guānshang · turn off/);

  // The picker remembers it (the device's IndexedDB `vr-worlds`).
  await expect.poll(() => page.evaluate(() => new Promise<number>((resolve) => {
    const open = indexedDB.open('vr-worlds');
    open.onsuccess = () => {
      try {
        const get = open.result.transaction('progress', 'readonly').objectStore('progress').get('market');
        get.onsuccess = () => resolve((get.result as { done?: string[] } | undefined)?.done?.length ?? 0);
        get.onerror = () => resolve(0);
      } catch {
        resolve(0);
      }
    };
    open.onerror = () => resolve(0);
  })), { timeout: 10_000 }).toBe(4);
  await page.goto('/vr/worlds');
  await expect(page.getByTestId('vr-world-card').filter({ hasText: '菜市场' })).toContainText('4 / 11 tasks', { timeout: 20_000 });
});
