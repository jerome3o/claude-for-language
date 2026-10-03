import { test, expect, APIRequestContext, Page, Locator } from '@playwright/test';

/**
 * Sheet footers: the primary action of a long sheet stays on screen while its
 * body scrolls (`.sheet-footer`, index.css). Checked at a short phone viewport
 * (412×600, the Fold's cover screen with the keyboard half up) on the sheets
 * Jerome hit: Edit card, Deck settings, Paste a list, Add note — Save is in the
 * viewport without scrolling, the body really does scroll under it, and after
 * scrolling to the end the footer does not cover the last field.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {},
): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

test.use({ viewport: { width: 412, height: 600 }, isMobile: true, hasTouch: true });

/** The element is fully inside the window, and not hidden under anything. */
async function expectReachable(page: Page, button: Locator) {
  await expect(button).toBeInViewport({ ratio: 1 });
  const box = (await button.boundingBox())!;
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.textContent ?? null, [box.x + box.width / 2, box.y + box.height / 2]);
  expect(hit).toBe(await button.textContent());
}

/** The sheet's body scrolls (so the test means something) and the footer never covers the last control. */
async function expectScrollsUnderFooter(scroller: Locator, footer: Locator, last: Locator) {
  const scrolls = await scroller.evaluate((el) => el.scrollHeight > el.clientHeight + 20);
  expect(scrolls).toBe(true);
  await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(last).toBeInViewport();
  const lastBox = (await last.boundingBox())!;
  const footBox = (await footer.boundingBox())!;
  expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(footBox.y + 1);
}

test('Save stays on screen in long sheets at 412×600', async ({ page, request }) => {
  test.setTimeout(120_000);
  const email = `sticky-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Sticky Save' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: '水果 Fruit' } });
  await api(request, `/api/decks/${deck.id}/notes`, {
    method: 'POST', token,
    data: {
      hanzi: '苹果', pinyin: 'píngguǒ', english: 'apple',
      fun_facts: '苹 (píng) apple + 果 (guǒ) fruit.\nThe everyday word for apple.\nAlso: 苹果手机 = iPhone.',
      sentence_clue: '我每天吃一个苹果。', sentence_clue_pinyin: 'Wǒ měitiān chī yí ge píngguǒ.', sentence_clue_translation: 'I eat an apple every day.',
    },
  });

  await page.goto(`/decks/${deck.id}?session_token=${token}`);
  const row = page.getByRole('button', { name: 'Edit 苹果' });
  await expect(row).toBeVisible({ timeout: 30_000 });

  // ---- Edit card: the fields scroll, Cancel / Save are pinned
  await row.click();
  const editor = page.locator('.card-edit-modal');
  await expect(editor).toBeVisible();
  await expectReachable(page, editor.getByRole('button', { name: 'Save', exact: true }));
  await expectScrollsUnderFooter(editor.locator('.card-edit-content'), editor.locator('.card-edit-footer'), editor.locator('.card-edit-content button').last());
  await expectReachable(page, editor.getByRole('button', { name: 'Save', exact: true }));
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor).toBeHidden();

  // ---- Deck settings: a long form; Save Settings pinned from the first frame
  await page.getByRole('button', { name: 'More deck actions' }).click();
  await page.getByText('⚙️ Settings').click();
  const settings = page.locator('.modal', { has: page.getByRole('heading', { name: 'Deck Settings' }) });
  await expect(settings).toBeVisible();
  const saveSettings = settings.getByRole('button', { name: 'Save Settings' });
  await expectReachable(page, saveSettings);
  await expectScrollsUnderFooter(settings, settings.locator('.sheet-footer'), settings.locator('input, textarea, select, button:not(.sheet-footer button)').last());
  await expectReachable(page, saveSettings);
  await settings.getByRole('button', { name: 'Cancel' }).click();

  // ---- Paste a list: many rows; the Add button stays put
  await page.getByRole('button', { name: /Paste list/ }).click();
  const paste = page.getByRole('dialog', { name: 'Paste a word list' });
  const words = ['米饭', '面条', '饺子', '包子', '鸡蛋', '牛奶', '咖啡', '面包', '蛋糕', '豆腐', '白菜', '土豆', '黄瓜', '牛肉'];
  await paste.getByRole('textbox', { name: 'Word list' }).fill(words.map((w) => `${w}\tpinyin\tmeaning`).join('\n'));
  await expect(paste.getByRole('button', { name: /^Add \d+/ })).toBeVisible();
  await expectReachable(page, paste.getByRole('button', { name: /^Add \d+/ }));
  await paste.evaluate((el) => { el.scrollTop = el.scrollHeight / 2; });
  await expectReachable(page, paste.getByRole('button', { name: /^Add \d+/ }));
  await paste.getByRole('button', { name: 'Cancel' }).click();
});
