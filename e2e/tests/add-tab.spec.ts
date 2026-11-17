import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import path from 'node:path';

/**
 * The learner's ＋ Add tab (docs/ADD_TAB.md): the tab bar's slot after Chats, ONE title, "Add a word"
 * (📷 a photo → the Chinese lines as word chips → the explorer → + Add as card; ✏️ type 银行 → the
 * explorer → ⚡ Study it today for a word he has), the content tiles (📖 Graded reader → a topic → "✓
 * Making your reader… Open ›"), and the old ✦ Claude tab's box now on the Chats tab (chips; sending
 * opens a thread). The photo is a synthetic fixture (e2e/tests/fixtures/images/subtitle-photo.png);
 * E2E_TEST_MODE answers the OCR with its stand-in.
 *
 * ADD_TAB_SHOTS=<dir> also saves screenshots there (PR screenshots).
 */
const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SHOTS = process.env.ADD_TAB_SHOTS;
const PHOTO = path.join(__dirname, 'fixtures', 'images', 'subtitle-photo.png');

interface Seeded { id: string; email: string; token: string }

async function api<T = unknown>(request: APIRequestContext, p: string, opts: { method?: string; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${p}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  expect(res.ok(), `${p} ${res.status()}`).toBeTruthy();
  return (await res.json()) as T;
}

async function seedUser(request: APIRequestContext, tag: string): Promise<Seeded> {
  const email = `add-tab-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  return { id: r.user.id, email, token: r.session_token };
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function openAdd(page: Page, user: Seeded) {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto(`/?session_token=${user.token}`);
  await page.locator('.header').waitFor({ timeout: 30_000 });
  await page.locator('.tab-bar [data-tab="add"]').click();
  await expect(page).toHaveURL(/\/add$/);
  await expect(page.getByTestId('add-page')).toBeVisible();
}

test('the tab bar has ＋ Add after Chats; /claude lands on the Chats tab\'s Claude box', async ({ page, request }) => {
  const user = await seedUser(request, 'tabs');
  await openAdd(page, user);
  await expect(page.locator('.tab-bar .tab-bar-label')).toHaveText(['Study', 'Chats', 'Add', 'Progress', 'More']);
  await expect(page.locator('.tab-bar [data-tab="add"]')).toHaveAttribute('aria-current', 'page');
  // ONE title.
  await expect(page.getByRole('heading', { name: 'Add', exact: true })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Add a word' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ask for new content' })).toBeVisible();
  await shot(page, '01-add-tab');

  await page.goto('/claude');
  await expect(page).toHaveURL(/\/chats$/);
  await expect(page.getByTestId('chats-composer-chips')).toBeVisible();
});

test('✏️ type 银行 → the explorer → ⚡ Study it today (a word he already has)', async ({ page, request }) => {
  test.setTimeout(120_000);
  const user = await seedUser(request, 'type');
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: user.token, data: { name: 'Bank words' } });
  await api(request, `/api/decks/${deck.id}/notes`, { method: 'POST', token: user.token, data: { hanzi: '银行', pinyin: 'yínháng', english: 'bank' } });
  await page.goto(`/decks?session_token=${user.token}`);
  await expect(page.getByText('Bank words').first()).toBeVisible({ timeout: 30_000 });
  await openAdd(page, user);

  await page.getByTestId('add-method-type').click();
  const box = page.getByTestId('add-word-input-text');
  await expect(box).toBeVisible();
  await box.fill('银行');
  await shot(page, '04-type');
  await page.getByTestId('add-word-input-submit').click();
  const word = page.getByRole('dialog', { name: 'The word 银行' });
  await expect(word).toBeVisible();
  const bump = word.getByRole('button', { name: /Study it today/ });
  await expect(bump).toBeVisible({ timeout: 15_000 });
  await shot(page, '05-type-explorer');
  await bump.click();
  await expect(word.locator('.bump-hint')).toBeVisible();
});

test('📷 a photo → the Chinese lines as word chips (the subtitle first) → + Add as card', async ({ page, request }) => {
  test.setTimeout(120_000);
  const user = await seedUser(request, 'photo');
  await openAdd(page, user);
  // The 📷 button opens the camera input at once; the test hands the file to it.
  await page.getByTestId('add-photo-camera-input').setInputFiles(PHOTO);
  await expect(page.getByTestId('add-photo-result')).toBeVisible();
  const lines = page.getByTestId('add-ocr-line');
  await expect(lines.first()).toBeVisible({ timeout: 20_000 });
  await expect(lines.first()).toContainText('太');
  await expect(page.getByText('Share screen')).toHaveCount(0);
  await shot(page, '02-photo-chips');
  // Tap the middle word.
  await lines.first().getByTestId('add-word-chip').filter({ hasText: '体面' }).click();
  const word = page.getByRole('dialog', { name: 'The word 体面' });
  await expect(word).toBeVisible();
  const add = word.getByTestId('explorer-add-card');
  await expect(add).toBeVisible({ timeout: 15_000 });
  await shot(page, '03-photo-explorer');
  await add.click();
  await expect(word.getByTestId('xp-added')).toBeVisible({ timeout: 15_000 });
});

test('📖 Graded reader → a topic → "✓ Making your reader… Open ›"', async ({ page, request }) => {
  test.setTimeout(120_000);
  const user = await seedUser(request, 'reader');
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: user.token, data: { name: 'Travel' } });
  for (const [hanzi, pinyin, english] of [['旅行', 'lǚxíng', 'to travel'], ['北京', 'Běijīng', 'Beijing'], ['火车', 'huǒchē', 'train'], ['朋友', 'péngyou', 'friend']]) {
    await api(request, `/api/decks/${deck.id}/notes`, { method: 'POST', token: user.token, data: { hanzi, pinyin, english } });
  }
  await page.goto(`/decks?session_token=${user.token}`);
  await expect(page.getByText('Travel').first()).toBeVisible({ timeout: 30_000 });
  await openAdd(page, user);

  await page.getByTestId('add-tile-reader').click();
  const sheet = page.getByTestId('add-content-sheet');
  await expect(sheet).toBeVisible();
  const type = sheet.getByTestId('add-content-input-type');
  if (await type.isVisible().catch(() => false)) await type.click();
  await sheet.getByTestId('add-content-input-text').fill('去北京旅行');
  await shot(page, '06-reader-sheet');
  await sheet.getByTestId('add-content-input-submit').click();
  const result = page.getByTestId('add-result').first();
  await expect(result).toContainText('Making your reader', { timeout: 30_000 });
  await shot(page, '07-reader-result');
  await result.getByTestId('add-result-open').click();
  await expect(page).toHaveURL(/\/readers\/[^/]+$/);
});

test('the Chats tab: the Claude box (chips) under the list; sending opens a thread', async ({ page, request }) => {
  const user = await seedUser(request, 'chats');
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto(`/chats?session_token=${user.token}`);
  await expect(page.getByTestId('chats-compose')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('chats-composer-chips')).toBeVisible();
  await shot(page, '08-chats-box');
  await page.getByTestId('claude-chat-voice-type').click().catch(() => {});
  const box = page.getByTestId('claude-chat-voice-text');
  await box.fill('“了”和“过”有什么不一样？');
  await page.getByTestId('claude-chat-voice-submit').click();
  await expect(page).toHaveURL(/\/chats\/claude\//, { timeout: 30_000 });
});
