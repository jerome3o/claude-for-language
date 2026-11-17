import { test, expect, APIRequestContext, Page } from '@playwright/test';
import { skipFirstCardExplainer } from './fixtures/explainer';

// The first-card explainer is not what this test is about (fixtures/explainer.ts).
test.beforeEach(async ({ context }) => skipFirstCardExplainer(context));
// The Pixel Fold, folded (screenshots with SHOT_DIR).
test.use({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });

/**
 * A word added from an example sentence's "What's going on here?" during a study session, then ⚡ Study it
 * today (shared/decks/study-today.ts + bump-next.ts; docs/STUDY_SESSION.md "⚡ Study it today"). Jerome, Nov
 * 2026: "when I add a new card from the example sentence, what's going on section, it doesn't add it as the
 * listening exercises" and "Don't add the new card to the mix straight away … it would be good if that blue
 * card appeared straight away." So: the word just added (its clip still being made) is bumped with its
 * LISTENING card ("Start new words by ear", on), the card on screen stays, and once it is rated the very next
 * card is that listening card.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SHOTS = process.env.SHOT_DIR;

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PUT'; token?: string; data?: unknown } = {},
): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** The note's cards are on this device (the sync after "+ Add as card" brought them down). */
async function cardsOnDevice(page: Page, hanzi: string): Promise<number> {
  return page.evaluate(
    (word) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('ChineseLearningDB');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['notes', 'cards'], 'readonly');
          const notes = tx.objectStore('notes').getAll();
          notes.onsuccess = () => {
            const note = (notes.result as Array<{ id: string; hanzi: string }>).find((n) => n.hanzi === word);
            if (!note) { resolve(0); db.close(); return; }
            const cards = tx.objectStore('cards').index('note_id').count(note.id);
            cards.onsuccess = () => { resolve(cards.result); db.close(); };
            cards.onerror = () => reject(cards.error);
          };
          notes.onerror = () => reject(notes.error);
        };
      }),
    hanzi,
  );
}

const CLUE = '老师喜欢在课上和学生互动。';

test('breakdown → word → + Add as card → ⚡: its listening card is the very next card', async ({ page, request }) => {
  test.setTimeout(180_000);
  const email = `bump-next-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome', new_words_by_ear: true } });
  const token = auth.session_token;
  await api(request, '/api/profile/study-budget', { method: 'PUT', token, data: { new_cards_per_day: 3, secondary_cards_per_day: 0 } });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'Classroom' } });
  for (const [hanzi, pinyin, english] of [['互动', 'hùdòng', 'to interact'], ['老师', 'lǎoshī', 'teacher'], ['学生', 'xuésheng', 'student']]) {
    await api(request, `/api/decks/${deck.id}/notes`, {
      method: 'POST', token, data: {
        hanzi, pinyin, english,
        sentence_clue: CLUE,
        sentence_clue_pinyin: 'Lǎoshī xǐhuan zài kè shang hé xuésheng hùdòng.',
        sentence_clue_translation: 'The teacher likes to interact with the students in class.',
      },
    });
  }
  // The breakdown (Haiku on the real server).
  await page.route('**/api/sentences/explain-text', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        explanation: {
          words: [
            { hanzi: '老师', pinyin: 'lǎoshī', gloss: 'teacher' },
            { hanzi: '喜欢', pinyin: 'xǐhuan', gloss: 'to like' },
            { hanzi: '互动', pinyin: 'hùdòng', gloss: 'to interact' },
          ],
          construction: '喜欢 + a whole activity: 在课上和学生互动.',
          translation: 'The teacher likes to interact with the students in class.',
        },
      }),
    });
  });

  await page.goto(`/decks?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await expect(page.getByText('Classroom')).toBeVisible({ timeout: 30000 });
  await page.goto('/study?autostart=true');

  // A listening card (by ear): turn it over.
  const showAnswer = page.getByRole('button', { name: /Show answer/i }).first();
  await expect(showAnswer).toBeVisible({ timeout: 30000 });
  await showAnswer.click();
  const onScreen = (await page.locator('.hanzi-large').first().textContent())?.trim();
  expect(['互动', '老师', '学生']).toContain(onScreen);

  // The card's sentence: open it line by line, then "What's going on here?".
  const explain = page.getByRole('button', { name: /going on here/ });
  for (let i = 0; i < 4 && !(await explain.isVisible().catch(() => false)); i++) {
    await page.locator('.sentence-set-hidden, .sentence-set-reveal').first().click();
    await page.waitForTimeout(150);
  }
  await expect(explain).toBeVisible();
  await explain.click();
  const breakdown = page.getByTestId('sentence-word-breakdown');
  await expect(breakdown).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-breakdown.png` });

  // 喜欢 → the explorer → + Add as card (one tap) → ⚡ Study it today.
  await breakdown.getByRole('button', { name: 'Explore 喜欢' }).click();
  const wordView = page.getByRole('dialog', { name: 'The word 喜欢' });
  await expect(wordView).toBeVisible();
  await wordView.getByTestId('explorer-add-card').click();
  await expect(wordView.getByTestId('added-to-deck')).toContainText('✓ Added to From example sentences', { timeout: 15000 });
  await wordView.getByRole('button', { name: '⚡ Study it today' }).click();
  await expect(wordView.getByText('⚡ Listening card of 喜欢 added to today')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-bumped-listening-card.png` });
  await page.getByTestId('explorer-close').click();
  await expect(page.getByTestId('explorer')).toHaveCount(0);

  // The card on screen stays.
  await expect(page.locator('.hanzi-large').first()).toHaveText(onScreen!);
  // The word reaches this device with the sync "+ Add as card" started.
  await expect.poll(() => cardsOnDevice(page, '喜欢'), { timeout: 30000 }).toBe(3);
  await page.waitForTimeout(500);

  // Rate it: the very next card is 喜欢's listening card.
  await page.getByRole('button', { name: /^Good/ }).first().dispatchEvent('click');
  await expect(page.getByRole('button', { name: 'Replay audio' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.hanzi-large')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-next-card-listening.png` });
  await page.getByRole('button', { name: /Show answer/i }).first().click();
  await expect(page.locator('.hanzi-large').first()).toHaveText('喜欢');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/04-next-card-answer.png` });
});
