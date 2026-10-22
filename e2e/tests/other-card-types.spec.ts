import { test, expect, APIRequestContext, Page } from '@playwright/test';
import { skipFirstCardExplainer } from './fixtures/explainer';

test.beforeEach(async ({ context }) => skipFirstCardExplainer(context));

/**
 * ⋯ → "Practise this word other ways…" (shared/decks/other-card-types.ts; docs/STUDY_SESSION.md
 * "Other card types"): on a read card, the sheet lists the word's other card types, English → 汉字
 * is ticked, Add makes a CARD-LEVEL ⚡ bump, and that card comes up later in the SAME session with
 * the ⚡ badge — a few cards after its sibling, not straight after. The server has the bump with
 * its card types.
 *
 * Self-contained: one deck of six new words (budget 6 new, 0 extra), no AI calls.
 * SHOTS=1 also writes the PR screenshots.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SHOTS = process.env.SHOTS ? '../docs/pr-screenshots/study-other-card-types' : null;

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

const WORDS = [
  { hanzi: '银行', pinyin: 'yínháng', english: 'bank' },
  { hanzi: '苹果', pinyin: 'píngguǒ', english: 'apple' },
  { hanzi: '学校', pinyin: 'xuéxiào', english: 'school' },
  { hanzi: '朋友', pinyin: 'péngyou', english: 'friend' },
  { hanzi: '电脑', pinyin: 'diànnǎo', english: 'computer' },
  { hanzi: '咖啡', pinyin: 'kāfēi', english: 'coffee' },
];

const reveal = (page: Page) => page.getByRole('button', { name: /Skip recording|Show Answer|Check Answer|Reveal/i }).first();

/** Reveal whatever card is up (a typing card gets its answer typed) and return its hanzi prompt / English. */
async function revealCard(page: Page) {
  await expect(reveal(page)).toBeVisible({ timeout: 15000 });
  const typed = page.locator('.study-typing-input, input[type="text"]').first();
  if (await typed.isVisible().catch(() => false)) await typed.fill('银行');
  await reveal(page).click();
  await page.getByTestId('study-action-row').waitFor({ timeout: 15000 });
}

test('a read card sends its English → 汉字 card into the same session, a few cards later', async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 412, height: 915 });
  const email = `othercards-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Other ways learner' } });
  const token = auth.session_token;
  await api(request, '/api/profile/study-budget', { method: 'PUT', token, data: { new_cards_per_day: 6, secondary_cards_per_day: 0 } });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'HSK 2' } });
  for (const w of WORDS) {
    await api(request, `/api/decks/${deck.id}/notes?check=none`, { method: 'POST', token, data: { ...w, fun_facts: `${w.hanzi} (${w.pinyin}) ${w.english}` } });
  }

  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('HSK 2').first()).toBeVisible({ timeout: 30000 });
  await expect(async () => {
    await page.goto(`/study?deck=${deck.id}&autostart=true`);
    await expect(reveal(page)).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 60000 });
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();

  // The first card is a read card (hanzi → meaning) of one of the words.
  const fullscreen = page.locator('.study-fullscreen');
  await revealCard(page);
  // Which word: its English shows on the answer side.
  const text = (await fullscreen.textContent()) ?? '';
  const first = WORDS.find((w) => text.includes(w.english))!;
  expect(first).toBeTruthy();

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: /Practise this word other ways/ }).click();
  const sheet = page.getByTestId('other-card-types-sheet');
  await expect(sheet).toContainText(`Practise ${first.hanzi} other ways`);
  await expect(page.getByTestId('other-card-row-hanzi_to_meaning')).toContainText('this card');
  await expect(page.getByTestId('other-card-row-meaning_to_hanzi')).toContainText('new');
  await expect(page.getByTestId('other-card-row-meaning_to_hanzi').locator('input')).toBeChecked();
  await expect(page.getByTestId('other-card-types-add')).toHaveText('⚡ Add 1 to today');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-01-sheet.png` });
  await page.getByTestId('other-card-types-add').click();
  await expect(page.getByTestId('other-card-types-done')).toHaveText('⚡ English → 汉字 comes up in a few cards');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-02-added.png` });
  await expect(sheet).toHaveCount(0, { timeout: 5000 });

  // The server has a card-level bump of that word.
  await expect(async () => {
    const mine = await api<{ bumps: Array<{ hanzi: string; source: string; card_types: string[] | null }> }>(request, '/api/me/bumps', { token });
    expect(mine.bumps.map((b) => [b.hanzi, b.source, b.card_types])).toEqual([[first.hanzi, 'study_card', ['meaning_to_hanzi']]]);
  }).toPass({ timeout: 15000 });

  // Rate on: the English → 汉字 card of that word comes up with the ⚡ badge, after at least 3 other cards.
  let shownAfter = 0;
  for (; shownAfter < 10; shownAfter++) {
    await page.locator('.rating-btn.good').click();
    await expect(reveal(page)).toBeVisible({ timeout: 15000 });
    if (await page.getByTestId('study-bump-badge').isVisible().catch(() => false)) break;
    await revealCard(page);
  }
  expect(shownAfter).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId('study-bump-badge')).toBeVisible();
  await expect(fullscreen).toContainText(first.english);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-03-in-session.png` });
});
