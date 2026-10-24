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
 */
test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  },
});

const FAKE_WS = 'wss://fake-soniox.test/transcribe-websocket';

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
async function stubSet(page: Page, noteId: string) {
  await page.route(`**/api/notes/${noteId}/sentences`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const now = new Date().toISOString();
    const sentences = SET.map((x, i) => ({
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

/** Study the deck and press the card's reveal button. */
async function revealFirstCard(page: Page, token: string, deckId: string) {
  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('Bank words').first()).toBeVisible({ timeout: 30000 });
  const reveal = page.getByRole('button', { name: /Skip recording|Show Answer|Check Answer|Reveal/i }).first();
  await expect(async () => {
    await page.goto(`/study?deck=${deckId}&autostart=true`);
    await expect(reveal).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 60000 });
  await reveal.click();
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

test.beforeEach(async ({ context }) => {
  await skipFirstCardExplainer(context);
  await context.addInitScript(() => {
    try { localStorage.setItem('sentence-gate-v1', '1'); } catch { /* ignore */ }
  });
});
test.use({ viewport: { width: 412, height: 915 } });

test('sentence gate: Skip the round → Good / Easy wait for the sentences, Again rates; rows get a 🎤 once open', async ({ page, request }) => {
  test.setTimeout(120_000);
  const { token, deck, note } = await seedBankNote(request, 'sentence-gate');
  await stubSet(page, note.id);
  await revealFirstCard(page, token, deck.id);

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

  // A tap on a locked Good rates nothing and says why.
  await page.getByTestId('rating-good').click({ force: true }); // aria-disabled: Playwright won't tap it otherwise
  await expect(gate).toContainText('right with 🎤 to unlock Good and Easy');
  await expect(back).toBeVisible();

  // The card's sentence: no 🎤 while blank, a read 🎤 left of ▶ once the Chinese is up…
  const row = page.locator('.sentence-set-row').first();
  await expect(row.getByTestId('sentence-practise-mic')).toHaveCount(0);
  await row.locator('.sentence-set-hidden').click();
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

test('sentence round: two said right open the answer with Good / Easy unlocked', async ({ page, request }) => {
  test.setTimeout(120_000);
  await fakeSoniox(page);
  const { token, deck, note } = await seedBankNote(request, 'sentence-round');
  await stubSet(page, note.id);
  await revealFirstCard(page, token, deck.id);
  await expect(page.getByTestId('sentence-round')).toBeVisible({ timeout: 15000 });

  const say = async (index: number, heard: string) => {
    await page.evaluate((h) => { (window as unknown as { __heard?: string }).__heard = h; }, heard);
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
  await page.evaluate((h) => { (window as unknown as { __heard?: string }).__heard = h; }, CLUE.hanzi);
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
});
