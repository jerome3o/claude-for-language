import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * Pictures on cards (shared/cards/note-image.ts; docs/STUDY_SESSION.md "Pictures on cards"):
 * - Edit card → Picture → ✨ Generate picture (E2E_TEST_MODE draws a fixed fake picture inline);
 * - in study the picture shows WITH the English on the meaning → hanzi question, and only on the
 *   answer side of hanzi → meaning (never giving the meaning away);
 * - Settings → Study → "Show pictures on cards" off hides them;
 * - your own photo: choose → square crop → upload, then Remove;
 * - ⋯ → 🖼 Illustrate this deck: estimate first, then every card without a picture gets one.
 *
 * Self-contained: seeds a user, a deck and notes through the E2E test-auth endpoint and the API.
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

async function seed(request: APIRequestContext, deckName: string, words: Array<{ hanzi: string; pinyin: string; english: string }>) {
  const email = `pictures-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Picture learner' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: deckName } });
  const notes: string[] = [];
  for (const w of words) notes.push((await api<{ id: string }>(request, `/api/decks/${deck.id}/notes`, { method: 'POST', token, data: w })).id);
  return { token, deckId: deck.id, notes };
}

// A 1×1 PNG (the crop renders it to a JPEG on the device).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');

async function openNoteEditor(page: Page, hanzi: string) {
  const row = page.locator('.deck-note-progress-item', { hasText: hanzi }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.click();
  await expect(page.getByTestId('note-picture-section')).toBeVisible({ timeout: 15000 });
}

test('a generated picture shows with the English on meaning → hanzi and only on the answer side of hanzi → meaning', async ({ page, request }) => {
  test.setTimeout(300_000);
  const { token, deckId } = await seed(request, '水果图片', [{ hanzi: '苹果', pinyin: 'píngguǒ', english: 'apple' }]);
  // The listen card's options come from an AI call: stub it so the card can be answered.
  await page.route('**/api/notes/*/generate-multiple-choice', async (route) => {
    await route.fulfill({ json: { multiple_choice_options: JSON.stringify([{ correct: '苹', options: ['苹', '平', '评', '萍'] }, { correct: '果', options: ['果', '课', '裹', '菓'] }]) } });
  });

  await page.goto(`/decks/${deckId}?session_token=${token}`);
  await openNoteEditor(page, '苹果');
  await expect(page.getByTestId('note-picture-empty')).toContainText('No picture yet');
  await page.getByTestId('note-picture-generate').click();
  await expect(page.getByTestId('note-picture-preview')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('note-picture-generate')).toHaveText('↻ Regenerate');
  await page.getByRole('button', { name: 'Cancel' }).click();
  // The deck row shows a thumbnail.
  await expect(page.getByTestId('deck-note-picture')).toBeVisible({ timeout: 15000 });

  await page.goto(`/study?deck=${deckId}&autostart=true`);
  const studyUrl = page.url();
  const gotIt = page.getByRole('button', { name: 'Got it' });
  const skip = page.getByTestId('skip-recording');
  const showAnswer = page.getByTestId('voice-show-answer');
  const showOptions = page.getByRole('button', { name: 'Show Options' });
  const nothingDue = page.getByText('Nothing due right now');
  const front = page.locator('.study-card-main').first();
  const seen = { readCard: false, meaningCard: false };

  for (let i = 0; i < 8 && !(seen.readCard && seen.meaningCard); i++) {
    await expect(skip.or(showAnswer).or(showOptions).or(nothingDue).first()).toBeVisible({ timeout: 30000 });
    if (await nothingDue.isVisible().catch(() => false)) {
      // The session can be built before every card of the note is on the device.
      await page.goto(studyUrl);
      continue;
    }
    await page.waitForTimeout(400);
    if (await gotIt.isVisible().catch(() => false)) await gotIt.click();

    if (await showOptions.isVisible().catch(() => false)) {
      // audio → hanzi: no picture on the question.
      await expect(page.getByTestId('study-picture-front')).toHaveCount(0);
      await showOptions.click();
      await page.getByTestId('mc-submit').click();
    } else if (await skip.isVisible().catch(() => false)) {
      // hanzi → meaning: the picture would give the meaning away — never on the question.
      await expect(front).toContainText('苹果');
      await expect(page.getByTestId('study-picture-front')).toHaveCount(0);
      seen.readCard = true;
      await skip.click();
    } else {
      // meaning → hanzi: the picture goes with the English prompt.
      await expect(front).toContainText('apple');
      await expect(page.getByTestId('study-picture-front')).toBeVisible();
      seen.meaningCard = true;
      await showAnswer.click();
    }
    const back = page.getByTestId('study-card-back');
    await expect(back).toBeVisible();
    await expect(back.getByTestId('study-picture-back')).toBeVisible();
    await page.getByRole('button', { name: /^Good/ }).first().click();
  }
  expect(seen).toEqual({ readCard: true, meaningCard: true });

  // The Try-it viewer follows the same rule; a tap on the picture shows it big.
  await page.goto(`/decks/${deckId}/try`);
  await expect(page.locator('.deck-try-card')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('try-picture-front')).toHaveCount(0);
  await page.locator('.deck-try-card').click();
  await page.getByTestId('try-picture-back').click();
  await expect(page.getByTestId('note-image-lightbox')).toBeVisible();
  await page.getByTestId('note-image-lightbox').click();
  await expect(page.getByTestId('note-image-lightbox')).toHaveCount(0);

  // Settings → Study → off: no pictures on cards.
  await page.goto('/settings');
  const toggle = page.getByTestId('card-pictures-toggle');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.goto(`/decks/${deckId}/try`);
  await expect(page.locator('.deck-try-card')).toBeVisible({ timeout: 60_000 });
  await page.locator('.deck-try-card').click();
  await expect(page.locator('.deck-try-back')).toBeVisible();
  await expect(page.getByTestId('try-picture-back')).toHaveCount(0);
});

test('your own photo: choose → crop → upload, then Remove; Illustrate this deck draws the rest', async ({ page, request }) => {
  test.setTimeout(120_000);
  const { token, deckId } = await seed(request, '动物图片', [
    { hanzi: '猫', pinyin: 'māo', english: 'cat' },
    { hanzi: '狗', pinyin: 'gǒu', english: 'dog' },
  ]);
  await page.goto(`/decks/${deckId}?session_token=${token}`);

  await openNoteEditor(page, '猫');
  await page.getByTestId('note-picture-file-input').setInputFiles({ name: 'cat.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('heading', { name: 'Crop the picture' })).toBeVisible();
  await page.getByTestId('crop-confirm').click();
  await expect(page.getByTestId('note-picture-preview')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('note-picture-section')).toContainText('Your own picture');

  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('note-picture-remove').click();
  await expect(page.getByTestId('note-picture-empty')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  // ⋯ → Illustrate this deck: the estimate, then both cards get a picture.
  await page.locator('.deck-menu-btn').click();
  await page.getByRole('menuitem', { name: /Illustrate this deck/ }).click();
  const sheet = page.getByTestId('illustrate-sheet');
  await expect(sheet.getByTestId('illustrate-estimate')).toContainText('2 pictures · about $0.14');
  await expect(sheet.getByTestId('illustrate-progress-label')).toHaveText('0 of 2 cards have a picture');
  await sheet.getByTestId('illustrate-start').click();
  await expect(sheet.getByTestId('illustrate-progress-label')).toHaveText('2 of 2 cards have a picture', { timeout: 15000 });
  await expect(sheet.getByTestId('illustrate-estimate')).toHaveText('Every card already has a picture');
  await sheet.getByTestId('illustrate-new-toggle').check();
  await sheet.locator('.sheet-footer').getByRole('button', { name: /Close|Cancel/ }).click();
  await expect(page.getByTestId('deck-note-picture')).toHaveCount(2, { timeout: 20000 });
  const status = await api<{ illustrate_new: boolean; with_image: number }>(request, `/api/decks/${deckId}/illustrate`, { token });
  expect(status).toMatchObject({ illustrate_new: true, with_image: 2 });
});
