import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * 🥽 VR worlds (docs/VR_WORLDS.md) in the flat preview — the same pointer pipeline the headset's
 * controllers use (a click is a ray from the camera, raycast against the objects' pick boxes and the
 * panels). Dev builds expose `window.__vrWorld`: where each object / panel button is on screen, the
 * task run, the texts the canvases draw, and moving an object by hand.
 *
 * Covers: the picker lists the kitchen; inspecting the cup shows 杯子 / bēizi / cup; "+ Add as card"
 * puts it in the "From VR" source deck; holding the mouse on an apple picks it up (task 1 done);
 * a cup on the table (task 2) and opening the fridge from its panel (task 3) are checked live.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
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
const inspected = (page: Page) => page.evaluate(() => (window as unknown as Win).__vrWorld.inspected());
const inspectTexts = (page: Page) => page.evaluate(() => (window as unknown as Win).__vrWorld.inspectTexts());
const place = (page: Page, id: string, at: [number, number, number]) => page.evaluate(([i, a]) => (window as unknown as Win).__vrWorld.place(i as string, a as [number, number, number]), [id, at] as const);
const objects = (page: Page) => page.evaluate(() => (window as unknown as { __vrWorld: Hook }).__vrWorld.objects());
const run = (page: Page) => page.evaluate(() => (window as unknown as { __vrWorld: Hook }).__vrWorld.run());

async function object(page: Page, id: string): Promise<WorldObject> {
  let o: WorldObject | undefined;
  await expect.poll(async () => {
    o = (await objects(page)).find((x) => x.id === id);
    return !!o?.visible;
  }, { timeout: 20_000, message: `${id} on screen` }).toBe(true);
  return o!;
}

async function tap(page: Page, panel: string, action: string | RegExp) {
  let target: Target | undefined;
  await expect.poll(async () => {
    const list = await page.evaluate(() => (window as unknown as { __vrWorld: Hook }).__vrWorld.targets());
    target = list.find((t) => t.visible && t.panel === panel && (typeof action === 'string' ? t.action === action : action.test(t.action)));
    return !!target;
  }, { timeout: 20_000, message: `${panel} ${action}` }).toBe(true);
  await page.mouse.click(target!.x, target!.y);
}

test('VR worlds: the kitchen — inspect, add as card, pick up, tasks', async ({ page, request }) => {
  test.setTimeout(180_000);
  const email = `vrw-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });

  await page.goto(`/decks?session_token=${token}`);
  await page.waitForLoadState('networkidle').catch(() => undefined);

  // The picker.
  await page.goto('/vr/worlds');
  const card = page.getByTestId('vr-world-card').filter({ hasText: '厨房' });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('0 / 9 tasks');
  await card.getByRole('link', { name: /Preview/ }).click();
  await expect(page).toHaveURL(/\/vr\/worlds\/kitchen$/);
  await expect(page.getByRole('note')).toContainText('Flat preview', { timeout: 60_000 });
  await page.waitForFunction(() => {
    const w = (window as unknown as { __vrWorld?: Hook }).__vrWorld;
    return !!w && w.objects().some((o) => o.id === 'cup' && o.visible) && w.targets().some((t) => t.panel === 'hud');
  }, null, { timeout: 90_000 });
  await page.waitForTimeout(1500); // things settle on the counter

  // Inspect the cup: its word.
  const cup = await object(page, 'cup');
  await page.mouse.click(cup.x, cup.y);
  await expect.poll(() => inspected(page)).toBe('cup');
  await expect.poll(() => inspectTexts(page), { timeout: 10_000 }).toEqual(expect.arrayContaining(['杯子', 'bēizi', 'cup', '一个杯子']));
  await expect.poll(() => inspectTexts(page)).toContain('＋ Add as card');

  // + Add as card → the "From VR" source deck.
  await tap(page, 'inspect', 'add');
  await expect.poll(async () => (await inspectTexts(page)).join('\n'), { timeout: 20_000 }).toMatch(/✓ Added to From VR/);
  const decks = await api<Array<{ id: string; name: string; source_key?: string | null }>>(request, '/api/decks', { token });
  const vrDeck = decks.find((d) => d.source_key === 'vr');
  expect(vrDeck?.name).toBe('From VR');
  const deck = await api<{ notes: Array<{ hanzi: string; pinyin: string; english: string; sentence_clue: string | null }> }>(request, `/api/decks/${vrDeck!.id}`, { token });
  expect(deck.notes).toEqual([expect.objectContaining({ hanzi: '杯子', pinyin: 'bēizi', english: 'cup', sentence_clue: '我要一个杯子。' })]);
  await tap(page, 'inspect', 'close');
  await expect.poll(() => inspected(page)).toBe(null);

  // Task 1 — 拿起一个苹果: hold the mouse on an apple.
  expect((await run(page)).taskIndex).toBe(0);
  const apple = await object(page, 'apple');
  await page.mouse.move(apple.x, apple.y);
  await page.mouse.down();
  await expect.poll(async () => (await run(page)).done, { timeout: 15_000 }).toContain('pick_apple');
  expect((await objects(page)).find((o) => o.id === 'apple')?.held).toBe(true);
  await page.mouse.up();

  // Task 2 — 把杯子放在桌子上: the engine sees a cup resting on the table.
  await expect(async () => {
    await place(page, 'cup', [-0.75, 0.85, -0.05]);
    await expect.poll(async () => (await run(page)).done, { timeout: 8_000 }).toContain('cup_on_table');
  }).toPass({ timeout: 40_000 });

  // Task 3 — 打开冰箱: the fridge's panel has the verb.
  const fridge = await object(page, 'fridge');
  await page.mouse.click(fridge.x, fridge.y);
  await expect.poll(async () => (await inspectTexts(page)).join('\n'), { timeout: 10_000 }).toMatch(/打开 dǎkāi · open/);
  await tap(page, 'inspect', 'use:door');
  await expect.poll(async () => (await run(page)).done, { timeout: 15_000 }).toContain('open_fridge');
  await expect.poll(async () => (await inspectTexts(page)).join('\n')).toMatch(/关上 guānshang · close/);

  // Progress is remembered on the picker (the device's own IndexedDB `vr-worlds`, written just after each task).
  await expect.poll(() => page.evaluate(() => new Promise<number>((resolve) => {
    const open = indexedDB.open('vr-worlds');
    open.onsuccess = () => {
      try {
        const get = open.result.transaction('progress', 'readonly').objectStore('progress').get('kitchen');
        get.onsuccess = () => resolve((get.result as { done?: string[] } | undefined)?.done?.length ?? 0);
        get.onerror = () => resolve(0);
      } catch {
        resolve(0);
      }
    };
    open.onerror = () => resolve(0);
  })), { timeout: 10_000 }).toBe(3);
  await page.goto('/vr/worlds');
  await expect(page.getByTestId('vr-world-card').filter({ hasText: '厨房' })).toContainText('3 / 9 tasks', { timeout: 20_000 });
});
