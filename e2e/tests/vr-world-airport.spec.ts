import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * 🥽 VR worlds — the airport (机场, docs/VR_WORLDS.md) in the flat preview. Same pointer pipeline as the
 * headset (a click is a ray from the camera); dev builds expose `window.__vrWorld` (objects on screen,
 * panel buttons, the task run, the inspect panel's texts, moving an object by hand).
 *
 * Covers: the picker lists the airport; inspecting the suitcase shows 行李箱 / xínglixiāng / suitcase /
 * 一个行李箱; task 1 (拿起你的护照) by holding the mouse on the passport after turning to the bench;
 * task 2 (both suitcases on the trolley — count in its inside) and task 3 (the big suitcase on the scale
 * — "on" a surface) checked live by the engine.
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
const run = (page: Page) => page.evaluate(() => (window as unknown as Win).__vrWorld.run());
const inspected = (page: Page) => page.evaluate(() => (window as unknown as Win).__vrWorld.inspected());
const inspectTexts = (page: Page) => page.evaluate(() => (window as unknown as Win).__vrWorld.inspectTexts());
const place = (page: Page, id: string, at: [number, number, number]) => page.evaluate(([i, a]) => (window as unknown as Win).__vrWorld.place(i as string, a as [number, number, number]), [id, at] as const);

async function object(page: Page, id: string): Promise<WorldObject> {
  let o: WorldObject | undefined;
  await expect.poll(async () => {
    o = (await objects(page)).find((x) => x.id === id);
    return !!o?.visible;
  }, { timeout: 20_000, message: `${id} on screen` }).toBe(true);
  return o!;
}

async function tap(page: Page, panel: string, action: string) {
  let target: Target | undefined;
  await expect.poll(async () => {
    const list = await page.evaluate(() => (window as unknown as Win).__vrWorld.targets());
    target = list.find((t) => t.visible && t.panel === panel && t.action === action);
    return !!target;
  }, { timeout: 20_000, message: `${panel} ${action}` }).toBe(true);
  await page.mouse.click(target!.x, target!.y);
}

/** Puts things somewhere and waits for the task (re-placing: a slow frame can put a body back). */
async function placeUntilDone(page: Page, task: string, moves: Array<[string, [number, number, number]]>) {
  await expect(async () => {
    for (const [id, at] of moves) await place(page, id, at);
    await expect.poll(async () => (await run(page)).done, { timeout: 8_000 }).toContain(task);
  }).toPass({ timeout: 60_000 });
}

test('VR worlds: the airport — inspect, pick up the passport, trolley and scale tasks', async ({ page, request }) => {
  test.setTimeout(240_000);
  const email = `vr-airport-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });

  await page.goto(`/decks?session_token=${token}`);
  await page.waitForLoadState('networkidle').catch(() => undefined);

  // The picker lists the airport.
  await page.goto('/vr/worlds');
  const card = page.getByTestId('vr-world-card').filter({ hasText: '机场' });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('0 / 12 tasks');
  await card.getByRole('link', { name: /Preview/ }).click();
  await expect(page).toHaveURL(/\/vr\/worlds\/airport$/);
  await expect(page.getByRole('note')).toContainText('Flat preview', { timeout: 60_000 });
  await page.waitForFunction(() => {
    const w = (window as unknown as { __vrWorld?: Hook }).__vrWorld;
    return !!w && w.objects().some((o) => o.id === 'suitcase' && o.visible) && w.targets().some((t) => t.panel === 'hud');
  }, null, { timeout: 90_000 });
  await page.waitForTimeout(1500); // things settle

  // Inspect the big suitcase: its word.
  const suitcase = await object(page, 'suitcase');
  await page.mouse.click(suitcase.x, suitcase.y);
  await expect.poll(() => inspected(page)).toBe('suitcase');
  await expect.poll(() => inspectTexts(page), { timeout: 10_000 }).toEqual(expect.arrayContaining(['行李箱', 'xínglixiāng', 'suitcase', '一个行李箱']));
  await tap(page, 'inspect', 'close');
  await expect.poll(() => inspected(page)).toBe(null);

  // Task 1 — 拿起你的护照: turn left (Q) until the passport on the bench is on screen, hold the mouse on it.
  expect((await run(page)).taskIndex).toBe(0);
  await page.keyboard.down('q');
  await expect.poll(async () => !!(await objects(page)).find((o) => o.id === 'passport')?.visible, { timeout: 60_000, intervals: [100] }).toBe(true);
  await page.keyboard.up('q');
  const passport = await object(page, 'passport');
  await page.mouse.move(passport.x, passport.y);
  await page.mouse.down();
  await expect.poll(async () => (await run(page)).done, { timeout: 20_000 }).toContain('pick_passport');
  expect((await objects(page)).find((o) => o.id === 'passport')?.held).toBe(true);
  await page.mouse.up();

  // Task 2 — 把两个行李箱放在手推车上: both suitcases inside the trolley's load space.
  const trolley = (await objects(page)).find((o) => o.id === 'trolley')!.pos;
  await placeUntilDone(page, 'bags_on_trolley', [
    ['suitcase', [trolley[0] - 0.15, 0.48, trolley[2]]],
    ['suitcase_2', [trolley[0] + 0.22, 0.42, trolley[2]]],
  ]);

  // Task 3 — 把大行李箱放在秤上: the big suitcase resting on the scale.
  await placeUntilDone(page, 'weigh_suitcase', [['suitcase', [-4.75, 0.62, 0.42]]]);
  expect((await run(page)).taskIndex).toBe(3);
});
