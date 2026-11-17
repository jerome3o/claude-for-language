import { test, expect, type APIRequestContext, type Page, type Route } from '@playwright/test';

/**
 * "+ Add as card" before the word's meaning has loaded (docs/LANGUAGE_EXPLORER.md "Adding before the
 * meaning has loaded"): a fast tap from the ＋ Add tab used to fail with the server's "english is
 * required". Now the tap waits for the dictionary ("Adding…") and saves the card with its meaning;
 * offline it opens the fill sheet — "What does 学校 mean?" — never a raw error.
 *
 * EXPLORER_ADD_SHOTS=<dir> also saves screenshots there (PR screenshots).
 */
const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SHOTS = process.env.EXPLORER_ADD_SHOTS;
// PR screenshots at the phone's density (Pixel Fold, folded).
if (SHOTS) test.use({ deviceScaleFactor: 2 });

async function seedUser(request: APIRequestContext, tag: string): Promise<string> {
  const email = `xp-add-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const res = await request.post(`${API}/api/test/auth`, { data: { email, name: 'Jerome' } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { session_token: string }).session_token;
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function openAdd(page: Page, token: string) {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto(`/?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30_000 });
  await page.goto('/progress');
  await expect(async () => {
    await page.locator('.tab-bar [data-tab="add"]').click();
    await expect(page).toHaveURL(/\/add$/, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId('add-page')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('add-method-type').click();
}

async function lookUp(page: Page, word: string) {
  const box = page.getByTestId('add-word-input-text');
  await expect(box).toBeVisible();
  await box.fill(word);
  await page.getByTestId('add-word-input-submit').click();
  const view = page.getByRole('dialog', { name: `The word ${word}` });
  await expect(view).toBeVisible();
  return view;
}

test('Add tapped while the dictionary is still loading waits ("Adding…") and saves the meaning', async ({ page, request }) => {
  test.setTimeout(120_000);
  const token = await seedUser(request, 'wait');
  await openAdd(page, token);
  // Hold the word dictionary's answer until the tap has happened.
  let release: () => void = () => {};
  const held = new Promise<void>((r) => { release = r; });
  await page.route('**/api/words?*', async (route: Route) => {
    await held;
    await route.continue();
  });
  const created: Array<{ hanzi: string; english: string; pinyin: string }> = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/api\/decks\/[^/]+\/notes$/.test(new URL(r.url()).pathname)) created.push(r.postDataJSON());
  });

  const view = await lookUp(page, '学校');
  const add = view.getByTestId('explorer-add-card');
  await expect(add).toBeVisible({ timeout: 15_000 });
  await add.click();
  await expect(add).toHaveText('Adding…');
  await expect(add).toBeDisabled();
  await shot(page, '01-adding');
  expect(created).toHaveLength(0);

  release();
  await expect(view.getByTestId('xp-added')).toBeVisible({ timeout: 20_000 });
  expect(created).toHaveLength(1);
  expect(created[0].hanzi).toBe('学校');
  expect(created[0].english.trim().length).toBeGreaterThan(0);
  expect(created[0].pinyin).toBe('xuéxiào');
  await expect(page.getByText('english is required')).toHaveCount(0);
});

test('offline: + Add as card opens the fill sheet with the meaning to type — no raw error', async ({ page, request, context }) => {
  test.setTimeout(120_000);
  const token = await seedUser(request, 'offline');
  await openAdd(page, token);
  await context.setOffline(true);

  const view = await lookUp(page, '学校');
  const add = view.getByTestId('explorer-add-card');
  await expect(add).toBeVisible({ timeout: 15_000 });
  await add.click();
  const fill = view.getByTestId('explorer-add-fill');
  await expect(fill).toBeVisible({ timeout: 15_000 });
  await expect(fill).toHaveAttribute('data-reason', 'offline');
  await expect(fill).toContainText('What does 学校 mean?');
  await expect(view.getByTestId('explorer-add-fill-hint')).toContainText('offline');
  await expect(view.getByTestId('explorer-add-fill-pinyin')).toHaveValue('xuéxiào');
  await expect(view.getByTestId('explorer-add-fill-english')).toHaveValue('');
  await shot(page, '02-offline-fill');
  await view.getByTestId('explorer-add-fill-english').fill('school');
  await expect(view.getByTestId('explorer-add-fill-save')).toHaveText('Waiting for a connection…');
  await expect(view.getByTestId('explorer-add-fill-save')).toBeDisabled();
  await shot(page, '03-offline-typed');
  await expect(page.getByText('english is required')).toHaveCount(0);

  // Back online: Add works.
  await context.setOffline(false);
  await expect(view.getByTestId('explorer-add-fill-save')).toBeEnabled();
  await view.getByTestId('explorer-add-fill-save').click();
  await expect(view.getByTestId('xp-added')).toBeVisible({ timeout: 20_000 });
});
