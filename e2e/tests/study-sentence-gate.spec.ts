import { test, expect, APIRequestContext, Page } from '@playwright/test';
import { skipFirstCardExplainer } from './fixtures/explainer';

/**
 * 🎤 on the study card's example sentence rows + "Get two sentences right before Good / Easy"
 * (docs/STUDY_SESSION.md "Practise a sentence aloud"; shared/study/sentencePractise.ts). With the
 * setting on (per device), a reading card's answer side says what unlocks Good, a tap on a locked
 * Good / Easy rates nothing and says why, Again still rates. A blank row has no 🎤; an open row has
 * a read 🎤 left of ▶; EN with the Chinese hidden makes it "Say it in Chinese".
 *
 * The Sentence round (docs/STUDY_SESSION.md "Sentence round"; shared/study/sentenceRound.ts): with
 * the setting on, the reveal goes to four sentence exercises first — Skip opens the answer with the
 * gate still locked; two said right (a faked live transcriber) open it with Good / Easy unlocked.
 *
 * Hard mode (docs/STUDY_SESSION.md "Hard mode"; shared/study/hardMode.ts): the question's own answer
 * is checked first — wrong → 🔁 Try again → right → the round; 👁 Show answer / Skip recording = a miss
 * (the answer at once, Good / Easy locked); the header chip switches Off · Red cards only · All cards,
 * and "Red cards only" leaves a card he's doing fine with alone but takes one rated Again today.
 */
test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  },
});

const FAKE_WS = 'wss://fake-soniox.test/transcribe-websocket';
/** SHOTS_DIR=… saves the PR screenshots (412×915 at 2×) along the way. */
const SHOTS = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** Soniox stand-in: hears `window.__heard` (interim after two chunks, final after the end-of-audio frame). */
async function fakeSoniox(page: Page) {
  await page.addInitScript((fakeUrl) => {
    const Real = window.WebSocket;
    class FakeSoniox extends EventTarget {
      readyState = 0;
      onopen: ((e: Event) => void) | null = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      onclose: ((e: CloseEvent) => void) | null = null;
      private configured = false;
      private chunks = 0;
      constructor(public url: string) {
        super();
        setTimeout(() => { this.readyState = 1; this.onopen?.(new Event('open')); }, 20);
      }
      private heard() { return (window as unknown as { __heard?: string }).__heard ?? ''; }
      private reply(o: object) { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(o) })); }
      send(data: unknown) {
        if (!this.configured) { this.configured = true; return; }
        if (data !== '') {
          this.chunks++;
          if (this.chunks === 2) this.reply({ tokens: [{ text: this.heard(), is_final: false }] });
          return;
        }
        setTimeout(() => {
          this.reply({ tokens: [{ text: this.heard(), is_final: true }, { text: '<fin>', is_final: true }] });
          this.reply({ tokens: [], finished: true });
        }, 30);
      }
      close() { this.readyState = 3; }
    }
    window.WebSocket = function (url: string | URL, protocols?: string | string[]) {
      return String(url) === fakeUrl ? new FakeSoniox(String(url)) : new Real(url, protocols);
    } as unknown as typeof WebSocket;
  }, FAKE_WS);
  await page.route('**/api/transcribe/live', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      provider: 'soniox', api_key: 'snx_temp_e2e', expires_at: new Date(Date.now() + 1800e3).toISOString(),
      websocket_url: FAKE_WS, model: 'stt-rt-v5', language_hints: ['zh', 'en'],
    }),
  }));
}

const CLUE = { hanzi: '我去银行取钱。', pinyin: 'Wǒ qù yínháng qǔ qián.', translation: 'I go to the bank to get money.' };
const SET = [
  { hanzi: '银行几点开门？', pinyin: 'Yínháng jǐ diǎn kāimén?', translation: 'What time does the bank open?' },
  { hanzi: '他在银行工作。', pinyin: 'Tā zài yínháng gōngzuò.', translation: 'He works at a bank.' },
  { hanzi: '银行旁边有一家饭馆。', pinyin: 'Yínháng pángbiān yǒu yì jiā fànguǎn.', translation: 'There is a restaurant next to the bank.' },
];

/** The note's set, as the server would hand it out (the device has none yet). */
async function stubSet(page: Page, noteId: string, set = SET) {
  await page.route(`**/api/notes/${noteId}/sentences`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const now = new Date().toISOString();
    const sentences = set.map((x, i) => ({
      id: `e2e-s${i}`, note_id: noteId, position: i, ...x, audio_url: null, focus: 'core', focus_note: null,
      explanation: null, created_at: now, updated_at: now,
    }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sentences }) });
  });
  await page.route('**/api/sentences/top-up', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"queued":0,"note_ids":[]}' }));
}

async function seedBankNote(request: APIRequestContext, prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Gate learner' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'Bank words' } });
  const note = await api<{ id: string }>(request, `/api/decks/${deck.id}/notes?check=none`, {
    method: 'POST',
    token,
    data: {
      hanzi: '银行', pinyin: 'yínháng', english: 'bank',
      sentence_clue: CLUE.hanzi, sentence_clue_pinyin: CLUE.pinyin, sentence_clue_translation: CLUE.translation,
    },
  });
  return { token, deck, note };
}

/** Study the deck: the reading card's question (Record / Skip recording). */
async function openCard(page: Page, token: string, deckId: string, deckName = 'Bank words') {
  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText(deckName).first()).toBeVisible({ timeout: 30000 });
  const record = page.getByRole('button', { name: 'Record Your Pronunciation' });
  await expect(async () => {
    await page.goto(`/study?deck=${deckId}&autostart=true`);
    await expect(record).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 60000 });
}

/** What the (faked) recogniser hears next: the live stream and the upload fallback alike. */
const heard = { text: '' };
async function hear(page: Page, text: string) {
  heard.text = text;
  await page.evaluate((h) => { (window as unknown as { __heard?: string }).__heard = h; }, text);
}

/** One take on the reading card: Record (unless Try again already started it) → Stop → Check Answer. */
async function takeRead(page: Page, text: string, opts: { started?: boolean } = {}) {
  await hear(page, text);
  if (!opts.started) await page.getByRole('button', { name: 'Record Your Pronunciation' }).click();
  const stop = page.getByRole('button', { name: 'Stop Recording' });
  await expect(stop).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1200);
  await stop.click();
  await page.getByRole('button', { name: 'Check Answer' }).click();
}

/** Hard mode's check of the question, right at once → the Sentence round. */
async function answerRight(page: Page) {
  await takeRead(page, '银行');
  await expect(page.getByTestId('hard-feedback')).toHaveAttribute('data-result', 'right', { timeout: 15000 });
  await expect(page.getByTestId('sentence-round')).toBeVisible({ timeout: 15000 });
}

/** The device's Hard mode setting (localStorage, before the app loads). */
async function setHardMode(page: Page, mode: 'off' | 'red' | 'all') {
  await page.addInitScript((m) => {
    try { localStorage.setItem('sentence-gate-v1', m); } catch { /* ignore */ }
  }, mode);
}

const API = process.env.E2E_API_URL || 'http://localhost:8787';

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

test.beforeEach(async ({ context, page }) => {
  await skipFirstCardExplainer(context);
  await fakeSoniox(page);
  await page.route(/\/api\/transcribe$/, (route) => route.fulfill({ json: { text: heard.text, language: 'zh', provider: 'e2e' } }));
});
test.use({ viewport: { width: 412, height: 915 }, deviceScaleFactor: process.env.SHOTS_DIR ? 2 : 1 });

test('hard mode: a wrong answer → Try again → right → the round; Skip → Good / Easy wait for the sentences, Again rates', async ({ page, request }) => {
  test.setTimeout(150_000);
  await setHardMode(page, 'all');
  const { token, deck, note } = await seedBankNote(request, 'sentence-gate');
  await stubSet(page, note.id);
  await openCard(page, token, deck.id);
  await expect(page.getByTestId('hard-mode-chip')).toHaveAttribute('data-mode', 'all');

  // Wrong: told at once on the question — Not quite, what he said, Try again / Show answer. No answer given away.
  await takeRead(page, '音乐');
  const feedback = page.getByTestId('hard-feedback');
  await expect(feedback).toHaveAttribute('data-result', 'wrong', { timeout: 15000 });
  await expect(feedback).toContainText('✗ Not quite');
  await expect(page.getByTestId('hard-said')).toContainText('音乐');
  await expect(page.getByTestId('study-card-back')).toHaveCount(0);
  await expect(page.getByTestId('sentence-round')).toHaveCount(0);
  await shot(page, 'hard-02-wrong-try-again');

  // Try again records again at once; right → "✓ Right" → the round by itself.
  await page.getByTestId('hard-try-again').click();
  await takeRead(page, '银行', { started: true });
  await expect(feedback).toHaveAttribute('data-result', 'right', { timeout: 15000 });
  await expect(feedback).toContainText('✓ Right');
  await expect(page.getByTestId('hard-next')).toContainText('Next: harder questions');
  await shot(page, 'hard-03-right-next');

  // The round first: four exercises, two read + two translate, the translate ones' Chinese hidden.
  const round = page.getByTestId('sentence-round');
  await expect(round).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('study-card-back')).toHaveCount(0);
  const exercises = page.getByTestId('sentence-round-exercise');
  await expect(exercises).toHaveCount(4);
  await expect(page.locator('[data-testid="sentence-round-exercise"][data-mode="read"]')).toHaveCount(2);
  await expect(page.locator('[data-testid="sentence-round-exercise"][data-mode="translate"]')).toHaveCount(2);
  await expect(exercises.nth(1)).toContainText(SET[0].translation);
  await expect(exercises.nth(1)).not.toContainText(SET[0].hanzi);
  await expect(page.getByTestId('sentence-round-counter')).toContainText('0 / 2');
  await expect(round).toContainText('Good and Easy stay locked until 2 more sentences are right');
  await shot(page, 'hard-04-round');
  await page.getByTestId('sentence-round-skip').click();

  const back = page.getByTestId('study-card-back');
  await expect(back).toBeVisible();
  const gate = page.getByTestId('sentence-gate');
  await expect(gate).toBeVisible({ timeout: 15000 });
  await expect(gate).toHaveAttribute('data-locked', 'true');
  await expect(gate).toContainText('Get 2 sentences right to unlock Good · 0/2');
  await expect(page.getByTestId('rating-good')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('rating-easy')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('rating-again')).not.toHaveAttribute('aria-disabled', 'true');
  // The round's sentences lead the list, opened, outlined "In the round" (untried: he skipped them).
  const roundRows = page.locator('.sentence-set-row.is-round');
  await expect(roundRows).toHaveCount(4);
  await expect(roundRows.first()).toHaveAttribute('data-round', 'untried');
  await expect(roundRows.first().locator('.sentence-set-hanzi')).toHaveText(CLUE.hanzi);
  await expect(roundRows.nth(1).locator('.sentence-set-translation')).toHaveText(SET[0].translation);

  // A tap on a locked Good rates nothing and says why.
  await page.getByTestId('rating-good').click({ force: true }); // aria-disabled: Playwright won't tap it otherwise
  await expect(gate).toContainText('right with 🎤 to unlock Good and Easy');
  await expect(back).toBeVisible();

  // The card's sentence (opened: it was in the round): a read 🎤 left of ▶…
  const row = page.locator('.sentence-set-row').first();
  await expect(row.locator('.sentence-set-hanzi')).toHaveText('我去银行取钱。');
  const mic = row.getByTestId('sentence-practise-mic');
  await expect(mic).toHaveAttribute('data-mode', 'read');
  const micBox = (await mic.boundingBox())!;
  const playBox = (await row.locator('.sentence-set-play').boundingBox())!;
  expect(micBox.x + micBox.width).toBeLessThanOrEqual(playBox.x + 1);
  // …and English-first with the Chinese hidden: say it in Chinese.
  await row.locator('.sentence-set-en').click();
  await expect(row.locator('.sentence-set-hanzi')).toHaveCount(0);
  await expect(row.getByTestId('sentence-practise-mic')).toHaveAttribute('data-mode', 'translate');

  // Again is always there.
  await page.getByTestId('rating-again').click();
  await expect(page.getByTestId('study-card-back')).toHaveCount(0, { timeout: 15000 });
  await expect(page.getByTestId('sentence-gate')).toHaveCount(0);
});

test('sentence round: two said right open the answer with Good / Easy unlocked, the round sentences on top', async ({ page, request }) => {
  test.setTimeout(150_000);
  await setHardMode(page, 'all');
  const { token, deck, note } = await seedBankNote(request, 'sentence-round');
  await stubSet(page, note.id);
  await openCard(page, token, deck.id);
  await answerRight(page);

  const say = async (index: number, heard: string) => {
    await hear(page, heard);
    const ex = page.getByTestId('sentence-round-exercise').nth(index);
    await ex.getByTestId('sentence-practise-mic').click();
    await expect(ex.getByTestId('sentence-practise-live')).toContainText(heard.replace(/[。？]/g, ''), { timeout: 10000 });
    await ex.getByTestId('sentence-practise-mic').click();
    return ex;
  };

  // A miss: Try again is offered, nothing counted.
  const first = await say(0, '我去学校。');
  await expect(first).toHaveAttribute('data-status', /close|wrong/, { timeout: 10000 });
  await expect(first.getByTestId('sentence-round-retry')).toBeVisible();
  await expect(page.getByTestId('sentence-round-counter')).toContainText('0 / 2');

  // Read the card's sentence right: 1 / 2 and a cheer.
  await hear(page, CLUE.hanzi);
  await first.getByTestId('sentence-round-retry').click();
  await expect(first.getByTestId('sentence-practise-live')).toBeVisible({ timeout: 10000 });
  await first.getByTestId('sentence-practise-mic').click();
  await expect(first).toHaveAttribute('data-status', 'right', { timeout: 10000 });
  await expect(page.getByTestId('sentence-round-counter')).toContainText('1 / 2');
  await expect(page.getByTestId('sentence-round-cheer')).toContainText('1 / 2');

  // Translate the first set sentence (said exactly): its Chinese shows once answered → 2 / 2.
  const second = await say(1, SET[0].hanzi);
  await expect(second).toHaveAttribute('data-status', 'right', { timeout: 10000 });
  await expect(second.getByTestId('sentence-round-chinese')).toHaveText(SET[0].hanzi);
  await expect(page.getByTestId('sentence-round-cheer')).toContainText('Good and Easy unlocked');

  // The answer side opens by itself, unlocked.
  await expect(page.getByTestId('study-card-back')).toBeVisible({ timeout: 10000 });
  const gate = page.getByTestId('sentence-gate');
  await expect(gate).toHaveAttribute('data-locked', 'false', { timeout: 15000 });
  await expect(gate).toContainText('2/2 right — Good and Easy unlocked');
  await expect(page.getByTestId('rating-good')).not.toHaveAttribute('aria-disabled', 'true');
  // The round's sentences first, opened, outlined with how each went.
  const roundRows = page.locator('.sentence-set-row.is-round');
  await expect(roundRows).toHaveCount(4);
  await expect(roundRows.nth(0)).toHaveAttribute('data-round', 'right');
  await expect(roundRows.nth(0).getByTestId('sentence-set-round-label')).toHaveText('In the round · ✓ Right');
  await expect(roundRows.nth(1)).toHaveAttribute('data-round', 'right');
  await expect(roundRows.nth(2)).toHaveAttribute('data-round', 'untried');
  await expect(roundRows.nth(2).getByTestId('sentence-set-round-label')).toHaveText('In the round');
  await expect(roundRows.nth(1).locator('.sentence-set-pinyin')).toHaveText(SET[0].pinyin);
  await shot(page, 'hard-06-answer-round-sentences');
});

test('sentence history: hide a sentence in the round (Undo), more sentences asked for, Show hidden on the answer side', async ({ page, request }) => {
  test.setTimeout(120_000);
  const { token, deck, note } = await seedBankNote(request, 'sentence-hide');
  await stubSet(page, note.id);
  const topUps: unknown[] = [];
  await page.route('**/api/sentences/top-up', async (route) => {
    topUps.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ queued: 1, note_ids: [note.id] }) });
  });
  await setHardMode(page, 'all');
  await openCard(page, token, deck.id);
  await answerRight(page);
  const exercises = page.getByTestId('sentence-round-exercise');
  await expect(exercises).toHaveCount(4);
  await expect(page.getByTestId('sentences-coming')).toHaveCount(0);

  // ⋯ on the last exercise → the sheet → "Too rare": it leaves the round.
  await exercises.nth(3).getByTestId('sentence-round-more').click();
  await expect(page.getByTestId('sentence-hide-sheet')).toBeVisible();
  await page.getByTestId('sentence-hide-too_rare').click();
  await expect(exercises).toHaveCount(3);
  await expect(page.getByText('Sentence hidden')).toBeVisible();
  // Fewer than four left in rotation: more sentences are on the way.
  await expect(page.getByTestId('sentences-coming')).toBeVisible();
  await expect.poll(() => topUps).toContainEqual({ note_ids: [note.id], reason: 'few' });

  // The hide reached the server.
  await expect.poll(async () => {
    const res = await api<{ events: Array<{ kind: string; reason: string | null }> }>(request, '/api/me/sentence-practice', { token });
    return res.events.map((e) => `${e.kind}:${e.reason}`);
  }).toContain('hide:too_rare');

  // The answer side lists three; ⋯ → Show hidden (1) → Show again.
  await page.getByTestId('sentence-round-skip').click();
  await expect(page.getByTestId('study-card-back')).toBeVisible();
  await expect(page.locator('.sentence-set-row:not(.is-hidden-row)')).toHaveCount(3);
  await page.getByRole('button', { name: 'Sentence options' }).click();
  await page.getByTestId('sentence-set-show-hidden').click();
  await expect(page.getByTestId('sentence-set-hidden-row')).toHaveCount(1);
  await page.getByTestId('sentence-set-hidden-row').scrollIntoViewIfNeeded();
  await page.getByTestId('sentence-set-unhide').click();
  await expect(page.getByTestId('sentence-set-hidden-row')).toHaveCount(0);
  await expect(page.locator('.sentence-set-row')).toHaveCount(4);
});

test('hard mode: Show answer before a right answer is a miss — the answer at once, no round, Good / Easy locked', async ({ page, request }) => {
  test.setTimeout(120_000);
  await setHardMode(page, 'all');
  const { token, deck, note } = await seedBankNote(request, 'hard-give-up');
  await stubSet(page, note.id);
  await openCard(page, token, deck.id);
  await page.getByTestId('skip-recording').click();
  await expect(page.getByTestId('study-card-back')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('sentence-round')).toHaveCount(0);
  const gate = page.getByTestId('sentence-gate');
  await expect(gate).toHaveAttribute('data-gave-up', 'true');
  await expect(gate).toContainText('You looked at the answer — Again or Hard this time');
  await expect(page.getByTestId('rating-good')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('rating-hard')).not.toHaveAttribute('aria-disabled', 'true');
  await shot(page, 'hard-05-gave-up');
  await page.getByTestId('rating-good').click({ force: true });
  await expect(gate).toContainText('Good and Easy stay locked on this card');
  await expect(page.getByTestId('study-card-back')).toBeVisible();
});

test('hard mode chip: Off · Red cards only · All in the header; Red cards only leaves a new card alone', async ({ page, request }) => {
  test.setTimeout(120_000);
  await setHardMode(page, 'all');
  const { token, deck, note } = await seedBankNote(request, 'hard-chip');
  await stubSet(page, note.id);
  await openCard(page, token, deck.id);
  const chip = page.getByTestId('hard-mode-chip');
  await expect(chip).toHaveText('🎯 All');
  await chip.click();
  await expect(page.getByTestId('hard-mode-menu')).toBeVisible();
  await shot(page, 'hard-01-chip-menu');
  await page.getByTestId('hard-mode-option-red').click();
  await expect(chip).toHaveAttribute('data-mode', 'red');
  await expect(chip).toHaveText('🎯 Red');
  // A new card is not red: straight to the answer, no round, no lock.
  await page.getByTestId('skip-recording').click();
  await expect(page.getByTestId('study-card-back')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('sentence-gate')).toHaveCount(0);
  await expect(page.getByTestId('rating-good')).not.toHaveAttribute('aria-disabled', 'true');
  await chip.click();
  await page.getByTestId('hard-mode-option-off').click();
  await expect(chip).toHaveText('🎯 Off');
  expect(await page.evaluate(() => localStorage.getItem('sentence-gate-v1'))).toBe('off');
});

test('Red cards only: a card rated Again today gets Hard mode; two sentences → a round of two', async ({ page, request }) => {
  test.setTimeout(150_000);
  await setHardMode(page, 'red');
  const { token, deck, note } = await seedBankNote(request, 'hard-red');
  await api(request, '/api/profile/study-budget', { method: 'PUT', token, data: { new_cards_per_day: 0, secondary_cards_per_day: 0 } });
  const { cards } = await api<{ cards: Array<{ id: string; card_type: string }> }>(request, `/api/notes/${note.id}`, { token });
  const card = cards.find((c) => c.card_type === 'hanzi_to_meaning')!;
  await api(request, '/api/reviews', {
    method: 'POST', token,
    data: { events: [{ id: `e2e-hard-red-${card.id}`, card_id: card.id, rating: 0, reviewed_at: new Date(Date.now() - 10 * 60_000).toISOString() }] },
  });
  // The card's own sentence + one set sentence: one exercise each, never the same sentence twice.
  const topUps: unknown[] = [];
  await stubSet(page, note.id, SET.slice(0, 1));
  await page.route('**/api/sentences/top-up', async (route) => {
    topUps.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"queued":1,"note_ids":[]}' });
  });
  await openCard(page, token, deck.id);
  await expect(page.getByTestId('hard-mode-chip')).toHaveText('🎯 Red');
  await answerRight(page);
  const exercises = page.getByTestId('sentence-round-exercise');
  await expect(exercises).toHaveCount(2);
  await expect(page.locator('[data-testid="sentence-round-exercise"][data-mode="read"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="sentence-round-exercise"][data-mode="translate"]')).toHaveCount(1);
  await expect(page.getByTestId('sentence-round')).toContainText('Get any 2 of these 2 right');
  // Fewer than four: more sentences are asked for.
  await expect.poll(() => topUps).toContainEqual({ note_ids: [note.id], reason: 'few' });
  await shot(page, 'hard-07-round-of-two');
});
