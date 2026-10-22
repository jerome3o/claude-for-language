import { test, expect, APIRequestContext, Page } from '@playwright/test';
import { skipFirstCardExplainer } from './fixtures/explainer';

// The first-card explainer is not what this test is about (fixtures/explainer.ts).
test.beforeEach(async ({ context }) => skipFirstCardExplainer(context));
// The Pixel Fold, folded (screenshots with SHOT_DIR).
test.use({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });

/**
 * "Listen in context" — a listening card's question side (docs/STUDY_SESSION.md): the note's
 * sentences as audio-only rows (the card's own sentence first, then the set; no Chinese on
 * screen; EN shows just the English), "▶ The word" at the bottom asking "Try the sentences
 * first?" until a sentence was heard, and a note with fewer than five sentences asks for a
 * background top-up. The set comes from the server (GET /api/notes/:id/sentences, stubbed:
 * the local worker writes no sets without a model) and the top-up is stubbed too.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SHOTS = process.env.SHOT_DIR;

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

const CLUE = '你周末打算做什么？';
const SET = [
  { hanzi: '我打算学中文。', pinyin: 'Wǒ dǎsuàn xué Zhōngwén.', translation: 'I plan to study Chinese.' },
  { hanzi: '你打算什么时候回家？', pinyin: 'Nǐ dǎsuàn shénme shíhou huí jiā?', translation: 'When do you plan to go home?' },
  { hanzi: '他算了算钱，打算买那辆车。', pinyin: 'Tā suànle suàn qián, dǎsuàn mǎi nà liàng chē.', translation: 'He counted his money and decided to buy that car.' },
];

/** Answer whatever card is up (reveal, then Easy) until the listening card shows. */
async function untilListeningCard(page: Page) {
  const listen = page.getByTestId('listen-context');
  for (let i = 0; i < 10; i++) {
    if (await listen.isVisible().catch(() => false)) return;
    const reveal = page.getByRole('button', { name: /Skip recording|Show answer|Check Answer/i }).first();
    await reveal.waitFor({ timeout: 30000 });
    if (await listen.isVisible().catch(() => false)) return;
    await reveal.click();
    await page.getByRole('button', { name: /^Easy/ }).first().click();
    await page.waitForTimeout(400);
  }
  await expect(listen).toBeVisible();
}

test('a listening card: the sentences first, the word last — "Try the sentences first?"', async ({ page, request }) => {
  test.setTimeout(120_000);
  const email = `listen-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'Plans' } });
  const note = await api<{ id: string }>(request, `/api/decks/${deck.id}/notes`, {
    method: 'POST', token, data: {
      hanzi: '打算', pinyin: 'dǎsuàn', english: 'to plan; to intend',
      sentence_clue: CLUE, sentence_clue_pinyin: 'Nǐ zhōumò dǎsuàn zuò shénme?', sentence_clue_translation: 'What are you planning to do this weekend?',
    },
  });

  // The note's set, as the server would hand it out.
  await page.route(`**/api/notes/${note.id}/sentences`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const now = new Date().toISOString();
    const sentences = SET.map((s, i) => ({
      id: `e2e-s${i}`, note_id: note.id, position: i, ...s, audio_url: null, focus: 'core', focus_note: null,
      explanation: null, created_at: now, updated_at: now,
    }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sentences }) });
  });
  const toppedUp: string[][] = [];
  await page.route('**/api/sentences/top-up', async (route) => {
    toppedUp.push((JSON.parse(route.request().postData() || '{}') as { note_ids: string[] }).note_ids);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ queued: 1, note_ids: [note.id] }) });
  });

  await page.goto(`/decks?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await expect(page.getByText('Plans')).toBeVisible({ timeout: 30000 });
  await page.goto(`/study?deck=${deck.id}&autostart=true`);
  await untilListeningCard(page);

  // The card sentence + the set, audio only: none of their Chinese or English on screen.
  const rows = page.getByTestId('listen-row');
  await expect(rows).toHaveCount(4);
  await expect(page.getByTestId('listen-context')).not.toContainText('打算');
  await expect(page.getByTestId('listen-context')).not.toContainText('weekend');
  // Fewer than five sentences: a background top-up was asked for.
  await expect.poll(() => toppedUp.flat()).toContain(note.id);

  // The word before any sentence: the ask (the auto-played first sentence counts as heard,
  // so start from a card where nothing was played: un-tick by reloading the card's state).
  const heard = await page.getByTestId('listen-row-play').first().getAttribute('aria-label');
  if (heard?.includes('played')) {
    // Auto-play heard sentence 1: the word plays at once.
    await page.getByTestId('listen-word').click();
    await expect(page.getByTestId('listen-word-prompt')).toHaveCount(0);
  } else {
    await page.getByTestId('listen-word').click();
    await expect(page.getByTestId('listen-word-prompt')).toContainText('Try the sentences first?');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-02-try-sentences-first.png` });
    await page.getByTestId('listen-word-sentence').click();
    await expect(page.getByTestId('listen-word-prompt')).toHaveCount(0);
    await expect(page.getByTestId('listen-row-play').first()).toHaveAttribute('aria-label', 'Sentence 1, played');
  }

  // EN on a set row shows only its English.
  await page.getByTestId('listen-row-en').nth(1).click();
  await expect(page.getByTestId('listen-row-translation')).toHaveText('I plan to study Chinese.');
  await expect(page.getByTestId('listen-context')).not.toContainText('我打算学中文');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-03-after-a-sentence.png` });

  // A sentence was heard: the word plays straight away.
  await page.getByTestId('listen-word').click();
  await expect(page.getByTestId('listen-word-prompt')).toHaveCount(0);
});

test('screenshots: the question, the ask, dark', async ({ page, request }) => {
  test.skip(!SHOTS, 'screenshots only');
  test.setTimeout(120_000);
  const email = `listen-shot-${Date.now()}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'Plans' } });
  const note = await api<{ id: string }>(request, `/api/decks/${deck.id}/notes`, {
    method: 'POST', token, data: { hanzi: '打算', pinyin: 'dǎsuàn', english: 'to plan; to intend', sentence_clue: CLUE, sentence_clue_translation: 'What are you planning to do this weekend?' },
  });
  await page.route(`**/api/notes/${note.id}/sentences`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const now = new Date().toISOString();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sentences: SET.map((s, i) => ({ id: `shot-s${i}`, note_id: note.id, position: i, ...s, audio_url: null, focus: 'core', focus_note: null, explanation: null, created_at: now, updated_at: now })) }) });
  });
  await page.route('**/api/sentences/top-up', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"queued":0,"note_ids":[]}' }));
  await page.goto(`/decks?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await page.goto(`/study?deck=${deck.id}&autostart=true`);
  await untilListeningCard(page);
  await expect(page.getByTestId('listen-row')).toHaveCount(4);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/web-01-question.png` });
  await page.getByTestId('listen-word').click();
  await page.waitForTimeout(400);
  if (await page.getByTestId('listen-word-prompt').isVisible()) await page.screenshot({ path: `${SHOTS}/web-02-try-sentences-first.png` });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByTestId('listen-row-en').nth(2).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/web-04-dark.png` });
});
