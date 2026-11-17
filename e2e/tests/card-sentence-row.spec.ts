import { test, expect, APIRequestContext, Page } from '@playwright/test';
import { skipFirstCardExplainer } from './fixtures/explainer';

/**
 * The card's own example sentence is one of the note's sentence rows (migration 0152,
 * shared/study/cardSentence.ts, docs/STUDY_SESSION.md "Example sentences — one model"):
 * - the API hands it out as the row `<note>-card` (is_card, first), and a write to the note's
 *   `sentence_clue*` fields (an older app, the MCP tools) moves the row with it;
 * - on the study card it is row 1 of the ONE sentence list ("From the card"), and editing the card's
 *   sentence in Edit card shows the new sentence as row 1 at once.
 */
test.beforeEach(async ({ context }) => skipFirstCardExplainer(context));
// The phone (Pixel Fold, folded) — also the PR screenshots' size.
test.use({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });

const API = process.env.E2E_API_URL || 'http://localhost:8787';
/** SHOTS_DIR=… saves the PR screenshots along the way. */
const SHOTS = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

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

type Row = { id: string; hanzi: string; translation: string | null; is_card?: number; position: number };

const FIRST = { hanzi: '我去银行取钱。', pinyin: 'Wǒ qù yínháng qǔ qián.', translation: 'I go to the bank to get money.' };
const SECOND = { hanzi: '银行几点开门？', pinyin: 'Yínháng jǐ diǎn kāimén?', translation: 'What time does the bank open?' };
const THIRD = '这家银行很大。';

async function seed(request: APIRequestContext) {
  const email = `card-row-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Card row' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'Bank words' } });
  const note = await api<{ id: string }>(request, `/api/decks/${deck.id}/notes?check=none`, {
    method: 'POST',
    token,
    data: { hanzi: '银行', pinyin: 'yínháng', english: 'bank', sentence_clue: FIRST.hanzi, sentence_clue_pinyin: FIRST.pinyin, sentence_clue_translation: FIRST.translation },
  });
  return { token, deck, note };
}

async function openCard(page: Page, token: string, deckId: string) {
  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('Bank words').first()).toBeVisible({ timeout: 30000 });
  const record = page.getByRole('button', { name: 'Record Your Pronunciation' });
  await expect(async () => {
    await page.goto(`/study?deck=${deckId}&autostart=true`);
    await expect(record).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 60000 });
}

test('the card sentence is the note\'s first sentence row, end to end', async ({ page, request }) => {
  test.setTimeout(150_000);
  const { token, deck, note } = await seed(request);

  // The API: one row, the card's own, first.
  let rows = (await api<{ sentences: Row[] }>(request, `/api/notes/${note.id}/sentences`, { token })).sentences;
  expect(rows.map((r) => [r.id, r.hanzi, r.is_card, r.position])).toEqual([[`${note.id}-card`, FIRST.hanzi, 1, -1]]);

  // An older client (or the MCP tools) writes the note's sentence_clue: the row follows, and a sync hands it out.
  const before = new Date(Date.now() - 1000).toISOString();
  await api(request, `/api/notes/${note.id}`, {
    method: 'PUT', token, data: { sentence_clue: SECOND.hanzi, sentence_clue_pinyin: SECOND.pinyin, sentence_clue_translation: SECOND.translation },
  });
  rows = (await api<{ sentences: Row[] }>(request, `/api/notes/${note.id}/sentences`, { token })).sentences;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: `${note.id}-card`, hanzi: SECOND.hanzi, translation: SECOND.translation, is_card: 1 });
  const changes = await api<{ sentences: Row[]; note_ids: string[] }>(request, `/api/sentences/changes?since=${encodeURIComponent(before)}`, { token });
  expect(changes.note_ids).toContain(note.id);
  expect(changes.sentences.find((r) => r.id === `${note.id}-card`)?.hanzi).toBe(SECOND.hanzi);

  // The study card: the answer side's ONE list, the card's sentence as row 1.
  await page.route('**/api/sentences/top-up', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"queued":0,"note_ids":[]}' }));
  await openCard(page, token, deck.id);
  await page.getByRole('button', { name: /Skip recording/i }).first().click();
  const list = page.getByTestId('study-sentences');
  await expect(list).toBeVisible({ timeout: 15000 });
  const first = list.locator('.sentence-set-row').first();
  await expect(first.locator('.sentence-set-from-card')).toHaveText('From the card');
  await first.locator('.sentence-set-hidden, .sentence-set-reveal').first().click();
  await expect(first.locator('.sentence-set-hanzi')).toHaveText(SECOND.hanzi);
  await first.scrollIntoViewIfNeeded();
  await shot(page, 'web-study-sentences');

  // Edit card → a new sentence → Save: row 1 is the new sentence at once (offline-first: from the note, then the row).
  await page.getByRole('button', { name: /Edit card/ }).click();
  const field = page.getByPlaceholder('Example sentence using this word...');
  await expect(field).toBeVisible({ timeout: 10000 });
  await field.fill(THIRD);
  await page.getByPlaceholder('Sentence pinyin...').fill('Zhè jiā yínháng hěn dà.');
  await page.getByPlaceholder('English translation...').fill('This bank is big.');
  await field.scrollIntoViewIfNeeded();
  await shot(page, 'web-edit-card');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(field).toBeHidden({ timeout: 15000 });
  const row1 = list.locator('.sentence-set-row').first();
  await expect(row1.locator('.sentence-set-from-card')).toHaveText('From the card');
  if (!(await row1.locator('.sentence-set-hanzi').isVisible().catch(() => false))) await row1.locator('.sentence-set-hidden, .sentence-set-reveal').first().click();
  await expect(row1.locator('.sentence-set-hanzi')).toHaveText(THIRD);
  await expect(list.locator('.sentence-set-hanzi', { hasText: SECOND.hanzi })).toHaveCount(0);
  await row1.scrollIntoViewIfNeeded();
  await shot(page, 'web-study-sentences-after-edit');

  // …and the server's row too.
  await expect(async () => {
    const now = (await api<{ sentences: Row[] }>(request, `/api/notes/${note.id}/sentences`, { token })).sentences;
    expect(now[0]).toMatchObject({ id: `${note.id}-card`, hanzi: THIRD, is_card: 1 });
  }).toPass({ timeout: 15000 });
});
