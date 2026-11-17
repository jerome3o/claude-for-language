import { test, expect, APIRequestContext, Page } from '@playwright/test';
import { skipFirstCardExplainer } from './fixtures/explainer';

// The first-card explainer is not what this test is about (fixtures/explainer.ts).
test.beforeEach(async ({ context }) => skipFirstCardExplainer(context));
// The Pixel Fold, folded (screenshots with SHOT_DIR).
test.use({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });

/**
 * The answer side keeps the question's order (docs/STUDY_SESSION.md, shared/study/answerOrder.ts): a listening
 * card's "Listen in context" rows are picked and shuffled per showing; after the reveal the "Example sentences"
 * list starts with exactly those sentences in exactly that order (the card's own sentence where it was), and a
 * reload (today is the session: the card comes back as it was) keeps it. The set is stubbed like
 * study-listen-context.spec.ts.
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

const CLUE = '他们明年结婚。';
const SET = [
  { hanzi: '我们结婚了。', pinyin: 'Wǒmen jiéhūn le.', translation: 'We got married.' },
  { hanzi: '她想跟他结婚。', pinyin: 'Tā xiǎng gēn tā jiéhūn.', translation: 'She wants to marry him.' },
  { hanzi: '我姐姐结婚了。', pinyin: 'Wǒ jiějie jiéhūn le.', translation: 'My older sister got married.' },
  { hanzi: '你什么时候结婚？', pinyin: 'Nǐ shénme shíhou jiéhūn?', translation: 'When are you getting married?' },
  { hanzi: '他们结婚十年了。', pinyin: 'Tāmen jiéhūn shí nián le.', translation: 'They have been married for ten years.' },
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
    await page.getByRole('button', { name: /^Easy/ }).first().dispatchEvent('click');
    await page.waitForTimeout(400);
  }
  await expect(listen).toBeVisible();
}

test('a listening card: the answer side lists the sentences in the question\'s order, and a reload keeps it', async ({ page, request }) => {
  test.setTimeout(180_000);
  const email = `answer-order-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'Weddings' } });
  const note = await api<{ id: string }>(request, `/api/decks/${deck.id}/notes`, {
    method: 'POST', token, data: {
      hanzi: '结婚', pinyin: 'jiéhūn', english: 'to get married',
      sentence_clue: CLUE, sentence_clue_pinyin: 'Tāmen míngnián jiéhūn.', sentence_clue_translation: 'They are getting married next year.',
    },
  });
  await page.route(`**/api/notes/${note.id}/sentences`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const now = new Date().toISOString();
    const sentences = SET.map((s, i) => ({
      id: `ao-s${i}`, note_id: note.id, position: i, ...s, audio_url: null, focus: 'core', focus_note: null,
      explanation: null, created_at: now, updated_at: now,
    }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sentences }) });
  });
  await page.route('**/api/sentences/top-up', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"queued":0,"note_ids":[]}' }));
  await page.route('**/api/sentences/*/ensure-audio', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"failed","audio_url":null}' }));

  await page.goto(`/decks?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await expect(page.getByText('Weddings')).toBeVisible({ timeout: 30000 });
  await page.goto(`/study?deck=${deck.id}&autostart=true`);
  await untilListeningCard(page);

  // The question: four sentences of the six, in this showing's shuffled order.
  const rows = page.getByTestId('listen-row');
  await expect(rows).toHaveCount(4);
  const question = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-key') ?? ''));
  expect(question.every((k) => k.length > 0)).toBe(true);
  await page.waitForTimeout(500);
  if (SHOTS) {
    // EN on every row, so the screenshot says which sentence is where.
    for (const en of await page.getByTestId('listen-row-en').all()) await en.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/web-01-listen-question.png` });
  }

  // Reveal: the answer side's list starts with exactly those, in exactly that order.
  await page.getByRole('button', { name: /Skip recording|Show answer|Check Answer/i }).first().click();
  const answerRows = page.locator('[data-testid="study-sentences"] .sentence-set-row');
  await expect(answerRows.first()).toBeVisible({ timeout: 15000 });
  const answerKeys = () => answerRows.evaluateAll((els) => els.map((el) => el.getAttribute('data-key') ?? ''));
  await expect.poll(async () => (await answerKeys()).slice(0, question.length)).toEqual(question);
  // Every sentence is still there once (the rest after them).
  const all = await answerKeys();
  expect(new Set(all).size).toBe(all.length);
  expect(all).toContain(`clue:${note.id}`);
  // The card's own sentence keeps its badge wherever it landed.
  await expect(page.locator(`[data-testid="study-sentences"] .sentence-set-row[data-key="clue:${note.id}"]`)).toHaveClass(/is-from-card/);
  if (SHOTS) {
    await page.getByRole('button', { name: 'Show all' }).click();
    await page.locator('[data-testid="study-sentences"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/web-02-listen-answer.png` });
    await page.getByRole('button', { name: 'Hide all' }).click();
  }

  // Today is the session: a reload brings the card back revealed — the same order (not a new pick).
  await page.reload();
  await expect(answerRows.first()).toBeVisible({ timeout: 30000 });
  await expect.poll(async () => (await answerKeys()).slice(0, question.length), { timeout: 15000 }).toEqual(question);
});

/**
 * Screenshots only: Hard mode's Sentence round on a reading card (already the rule before; now the same
 * `answerSentenceOrder`): the round's sentences lead the answer side in the round's order, the card's own
 * sentence after them. The showing is set up through the resume point (today is the session) so the round's
 * exercises are known.
 */
test('screenshots: the Sentence round and its answer side in the same order', async ({ page, request, context }) => {
  test.skip(!SHOTS, 'screenshots only');
  test.setTimeout(180_000);
  const email = `answer-order-round-${Date.now()}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'Weddings' } });
  const note = await api<{ id: string; cards?: Array<{ id: string; card_type: string }> }>(request, `/api/decks/${deck.id}/notes?check=none`, {
    method: 'POST', token, data: {
      hanzi: '结婚', pinyin: 'jiéhūn', english: 'to get married',
      sentence_clue: CLUE, sentence_clue_pinyin: 'Tāmen míngnián jiéhūn.', sentence_clue_translation: 'They are getting married next year.',
    },
  });
  const full = await api<{ cards?: Array<{ id: string; card_type: string }>; note?: { cards?: Array<{ id: string; card_type: string }> } }>(request, `/api/notes/${note.id}`, { token });
  const cards = full.cards ?? full.note?.cards ?? note.cards ?? [];
  const reading = cards.find((c) => c.card_type === 'hanzi_to_meaning')!;
  await page.route(`**/api/notes/${note.id}/sentences`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const now = new Date().toISOString();
    const sentences = SET.map((s, i) => ({
      id: `ro-s${i}`, note_id: note.id, position: i, ...s, audio_url: null, focus: 'core', focus_note: null,
      explanation: null, created_at: now, updated_at: now,
    }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sentences }) });
  });
  await page.route('**/api/sentences/top-up', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"queued":0,"note_ids":[]}' }));
  const log = [{ id: 'read:ro-s1', result: 'right' }, { id: 'translate:ro-s2', result: 'close' }, { id: 'read:ro-s4' }];
  await context.addInitScript(() => { try { localStorage.setItem('sentence-gate-v1', 'all'); } catch { /* ignore */ } });
  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('Weddings').first()).toBeVisible({ timeout: 30000 });
  const setPoint = (extra: Record<string, unknown>) => page.evaluate(({ cardId, deckId, extra }) => {
    const d = new Date(Date.now() - 4 * 3600_000);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    localStorage.setItem('study-resume-v1', JSON.stringify({ day, scope: deckId, card_id: cardId, answer: '', elapsed_ms: 0, ...extra }));
  }, { cardId: reading.id, deckId: deck.id, extra });

  // The answer side first (it brings the set onto the device), then the round itself.
  await setPoint({ revealed: true, round_log: log, sentences_right: ['read:ro-s1'] });
  await page.goto(`/study?deck=${deck.id}&autostart=true`);
  const answerRows = page.locator('[data-testid="study-sentences"] .sentence-set-row');
  await expect(answerRows.first()).toBeVisible({ timeout: 30000 });
  await expect.poll(async () => (await answerRows.evaluateAll((els) => els.map((el) => el.getAttribute('data-key')))).slice(0, 4))
    .toEqual(['ro-s1', 'ro-s2', 'ro-s4', `clue:${note.id}`]);
  await page.locator('[data-testid="study-sentences"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/web-04-round-answer.png` });

  await setPoint({ revealed: false, round_open: true, round_log: log.map((e) => ({ id: e.id })) });
  await page.goto(`/study?deck=${deck.id}&autostart=true`);
  await expect(page.getByTestId('sentence-round')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/web-03-round-question.png` });
});
