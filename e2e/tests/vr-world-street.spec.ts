import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * 🥽 VR worlds — 街上 On the street (docs/VR_WORLDS.md), in the flat preview. Dev builds expose
 * `window.__vrWorld` (objects on screen, panel buttons, the task run, the inspect panel's texts, moving
 * an object by hand); clicks are real pixels through the same raycast a controller uses.
 *
 * Covers: the picker lists the street; inspecting the newspaper shows 报纸 / bàozhǐ / newspaper and
 * its measure word; holding the mouse on it picks it up (task 1); the plastic bottle lying in the blue
 * recycling bin completes task 2; the street lamp's panel turns it on (task 3, its verb flips to 关上).
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
type Win = { __vrWorld?: Hook };

const hook = <T,>(page: Page, fn: (w: Hook, arg: unknown) => T, arg?: unknown) =>
  page.evaluate(([f, a]) => (new Function('w', 'a', `return (${f})(w, a)`))((window as unknown as Win).__vrWorld, a), [fn.toString(), arg] as const) as Promise<T>;
const run = (page: Page) => hook(page, (w) => w.run());
const inspectTexts = (page: Page) => hook(page, (w) => w.inspectTexts());

async function object(page: Page, id: string): Promise<WorldObject> {
  let o: WorldObject | undefined;
  await expect.poll(async () => {
    o = (await hook(page, (w) => w.objects())).find((x) => x.id === id);
    return !!o?.visible;
  }, { timeout: 20_000, message: `${id} on screen` }).toBe(true);
  return o!;
}

async function tap(page: Page, panel: string, action: string) {
  let target: Target | undefined;
  await expect.poll(async () => {
    target = (await hook(page, (w) => w.targets())).find((t) => t.visible && t.panel === panel && t.action === action);
    return !!target;
  }, { timeout: 20_000, message: `${panel} ${action}` }).toBe(true);
  await page.mouse.click(target!.x, target!.y);
}

test('VR worlds: the street — inspect, pick up, recycle, the street lamp', async ({ page, request }) => {
  test.setTimeout(180_000);
  const email = `vrw-street-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  await page.goto(`/decks?session_token=${token}`);
  await page.waitForLoadState('networkidle').catch(() => undefined);

  // The picker lists the street.
  await page.goto('/vr/worlds');
  const card = page.getByTestId('vr-world-card').filter({ hasText: '街上' });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('0 / 12 tasks');
  await card.getByRole('link', { name: /Preview/ }).click();
  await expect(page).toHaveURL(/\/vr\/worlds\/street$/);
  await page.waitForFunction(() => {
    const w = (window as unknown as Win).__vrWorld;
    return !!w && w.objects().some((o) => o.id === 'newspaper' && o.visible) && w.targets().some((t) => t.panel === 'hud');
  }, null, { timeout: 90_000 });
  await page.waitForTimeout(1500); // things settle

  // Inspect the newspaper on the pavement: its word.
  const paper = await object(page, 'newspaper');
  await page.mouse.click(paper.x, paper.y);
  await expect.poll(() => hook(page, (w) => w.inspected())).toBe('newspaper');
  await expect.poll(() => inspectTexts(page), { timeout: 10_000 }).toEqual(expect.arrayContaining(['报纸', 'bàozhǐ', 'newspaper', '一份报纸']));
  await tap(page, 'inspect', 'close');
  await expect.poll(() => hook(page, (w) => w.inspected())).toBe(null);

  // Task 1 — 把地上的报纸捡起来: hold the mouse on it.
  expect((await run(page)).taskIndex).toBe(0);
  const paper2 = await object(page, 'newspaper');
  await page.mouse.move(paper2.x, paper2.y);
  await page.mouse.down();
  await expect.poll(async () => (await run(page)).done, { timeout: 15_000 }).toContain('pick_newspaper');
  await page.mouse.up();

  // Task 2 — 把塑料瓶放进可回收垃圾桶里: the bottle lies in the blue bin.
  await expect(async () => {
    await hook(page, (w, at) => w.place('plastic_bottle', at as [number, number, number]), [2.5, 0.35, 1.05]);
    await expect.poll(async () => (await run(page)).done, { timeout: 8_000 }).toContain('bottle_recycle');
  }).toPass({ timeout: 40_000 });

  // Task 3 — 天黑了，把路灯打开吧: the lamp's panel has the verb, then offers to turn it off.
  await hook(page, (w) => w.inspect('street_lamp'));
  await expect.poll(async () => (await inspectTexts(page)).join('\n'), { timeout: 10_000 }).toMatch(/路灯[\s\S]*打开 dǎkāi · turn on/);
  await tap(page, 'inspect', 'use:light');
  await expect.poll(async () => (await run(page)).done, { timeout: 15_000 }).toContain('lamp_on');
  await expect.poll(async () => (await inspectTexts(page)).join('\n')).toMatch(/关上 guānshang · turn off/);
  expect((await run(page)).taskIndex).toBe(3);
});
