import { test, expect, APIRequestContext, Page } from '@playwright/test';
import { skipFirstCardExplainer } from './fixtures/explainer';

/**
 * Hard mode's "Sentences by ear" (docs/STUDY_SESSION.md "Sentences by ear"; shared/study/sentenceRound.ts):
 * in the Sentence round a read slot whose sentence has a clip is a LISTEN exercise — the clip plays when he
 * taps ▶ Tap to listen (never by itself) with no text on screen, he gives the meaning in English (voice-first box: ✏️ Type or 🎤 Say it),
 * the lesson answer check judges the meaning (the E2E stand-in, services/answer-check-fake.ts), the
 * Chinese / pinyin / English show at once with the verdict under them, and the attempt goes into the
 * sentence history as mode listen. Settings → Study → "Sentences by ear in Hard mode" off = read again.
 */
test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  },
});
test.use({ viewport: { width: 412, height: 915 }, deviceScaleFactor: process.env.SHOTS_DIR ? 2 : 1 });

const FAKE_WS = 'wss://fake-soniox.test/transcribe-websocket';
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

const heard = { text: '' };
async function hear(page: Page, text: string) {
  heard.text = text;
  await page.evaluate((h) => { (window as unknown as { __heard?: string }).__heard = h; }, text);
}

/** A short silent WAV (the clips' stand-in: real audio the browser can play). */
function silentWav(ms = 400): Buffer {
  const rate = 8000;
  const n = Math.round((rate * ms) / 1000);
  const b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  b.fill(128, 44);
  return b;
}

const CLUE = { hanzi: '我去银行取钱。', pinyin: 'Wǒ qù yínháng qǔ qián.', translation: 'I go to the bank to get money.' };
const SET = [
  { hanzi: '银行几点开门？', pinyin: 'Yínháng jǐ diǎn kāimén?', translation: 'What time does the bank open?' },
  { hanzi: '他在银行工作。', pinyin: 'Tā zài yínháng gōngzuò.', translation: 'He works at a bank.' },
  { hanzi: '银行旁边有一家饭馆。', pinyin: 'Yínháng pángbiān yǒu yì jiā fànguǎn.', translation: 'There is a restaurant next to the bank.' },
];

/** The note's set with clips, as the server hands it out; the clips themselves are a silent WAV. */
async function stubSetWithClips(page: Page, noteId: string) {
  await page.route(`**/api/notes/${noteId}/sentences`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const now = new Date().toISOString();
    const sentences = SET.map((x, i) => ({
      id: `e2e-s${i}`, note_id: noteId, position: i, ...x, audio_url: `generated/e2e-ear-s${i}.mp3`, focus: 'core', focus_note: null,
      explanation: null, created_at: now, updated_at: now,
    }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sentences }) });
  });
  await page.route('**/api/audio/generated/e2e-ear-*', (route) => route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav(3000) }));
  await page.route('**/api/sentences/top-up', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"queued":0,"note_ids":[]}' }));
}

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

async function seedBankNote(request: APIRequestContext) {
  const email = `by-ear-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Ear learner' } });
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

async function openCard(page: Page, token: string, deckId: string) {
  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('Bank words').first()).toBeVisible({ timeout: 30000 });
  const record = page.getByRole('button', { name: 'Record Your Pronunciation' });
  await expect(async () => {
    await page.goto(`/study?deck=${deckId}&autostart=true`);
    await expect(record).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 60000 });
}

/** Hard mode's question answered right at once (the reading card read aloud) → the Sentence round. */
async function toTheRound(page: Page) {
  await hear(page, '银行');
  await page.getByRole('button', { name: 'Record Your Pronunciation' }).click();
  const stop = page.getByRole('button', { name: 'Stop Recording' });
  await expect(stop).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1200);
  await stop.click();
  await page.getByRole('button', { name: 'Check Answer' }).click();
  await expect(page.getByTestId('sentence-round')).toBeVisible({ timeout: 20000 });
}

test.beforeEach(async ({ context, page }) => {
  await skipFirstCardExplainer(context);
  await context.addInitScript(() => {
    try { localStorage.setItem('sentence-gate-v1', 'all'); } catch { /* ignore */ }
  });
  await fakeSoniox(page);
  await page.route(/\/api\/transcribe$/, (route) => route.fulfill({ json: { text: heard.text, language: 'zh', provider: 'e2e' } }));
});

test('sentences by ear: the clip plays with no text, the meaning in English is checked, the reveal and the verdict show', async ({ page, request }) => {
  test.setTimeout(180_000);
  const { token, deck, note } = await seedBankNote(request);
  await stubSetWithClips(page, note.id);
  await openCard(page, token, deck.id);
  await toTheRound(page);

  // The read slots with clips are listen exercises; translate slots stay.
  const listen = page.locator('[data-testid="sentence-round-exercise"][data-mode="listen"]');
  await expect(listen.first()).toBeVisible({ timeout: 15000 });
  expect(await listen.count()).toBeGreaterThanOrEqual(1);
  await expect(page.locator('[data-testid="sentence-round-exercise"][data-mode="translate"]')).toHaveCount(2);
  const first = listen.first();
  // Nothing plays by itself: one big ▶ Tap to listen; a tap plays it (▶ lights up while the stand-in plays).
  await expect(first.getByTestId('sentence-listen-tap')).toBeVisible({ timeout: 10000 });
  await expect(first.getByTestId('sentence-listen-play')).toHaveCount(0);
  await shot(page, 'web-00-listen-tap');
  await first.getByTestId('sentence-listen-tap').click();
  await expect(first.getByTestId('sentence-listen-play')).toHaveClass(/is-playing/, { timeout: 10000 });
  const key = (await first.getAttribute('data-exercise'))!.replace('listen:', '');
  const sentence = key.startsWith('clue:') ? CLUE : SET[Number(key.replace('e2e-s', ''))];
  // No text before the answer: no Chinese, no English.
  await expect(first).not.toContainText(sentence.hanzi);
  await expect(first).not.toContainText(sentence.translation);
  await expect(first).toContainText('What does it mean?');
  await expect(first.getByTestId('sentence-listen-slow')).toBeVisible();
  await shot(page, 'web-01-listen-question');

  // ✏️ Type the meaning; the attempt is recorded as listen.
  const recorded = page.waitForRequest((r) => r.url().includes('/api/me/sentence-practice') && r.method() === 'POST' && (r.postData() ?? '').includes('"mode":"listen"'), { timeout: 30000 });
  await first.getByTestId('sentence-listen-input-type').click();
  await first.getByTestId('sentence-listen-input-text').fill(sentence.translation.replace(/[.?]$/, '').toLowerCase());
  await first.getByTestId('sentence-listen-input-submit').click();
  // The reveal at once; his English = the sentence's English → right with no model call.
  await expect(first.getByTestId('sentence-round-chinese')).toHaveText(sentence.hanzi);
  await expect(first.getByTestId('sentence-listen-english')).toHaveText(sentence.translation);
  await expect(first).toHaveAttribute('data-status', 'right', { timeout: 15000 });
  await expect(first.getByTestId('sentence-listen-verdict')).toContainText('✓ Right');
  await expect(page.getByTestId('sentence-round-counter')).toContainText('1 / 2');
  await recorded;
  await shot(page, 'web-02-listen-right');

  let done = false;
  // The next listen exercise (when there is one) has the floor: 🎤 Say it, in English, checked by Claude.
  if (await listen.count() > 1) {
    const second = listen.nth(1);
    await expect(second.getByTestId('sentence-listen-input-say')).toBeVisible({ timeout: 10000 });
    await hear(page, 'I like apples');
    await second.getByTestId('sentence-listen-input-say').click();
    await expect(second.getByTestId('sentence-listen-input-live')).toContainText('I like apples', { timeout: 10000 });
    await second.getByTestId('sentence-listen-input-stop').click();
    await second.getByTestId('sentence-listen-input-submit').click();
    await expect(second.getByTestId('sentence-listen-reveal')).toBeVisible();
    await expect(second).toHaveAttribute('data-status', 'wrong', { timeout: 20000 });
    await expect(second.getByTestId('sentence-listen-said')).toContainText('I like apples');
    await expect(second.getByTestId('sentence-listen-verdict')).toContainText('✗ Not quite');
    await shot(page, 'web-03-listen-wrong');
    // 🔁 Try again, the answer seen: the box opens again; the right meaning now counts (2 / 2).
    await second.getByTestId('sentence-listen-retry').click();
    await second.getByTestId('sentence-listen-input-type').click();
    const key2 = (await second.getAttribute('data-exercise'))!.replace('listen:', '');
    const sentence2 = key2.startsWith('clue:') ? CLUE : SET[Number(key2.replace('e2e-s', ''))];
    await second.getByTestId('sentence-listen-input-text').fill(sentence2.translation.replace(/[.?]$/, '').toLowerCase());
    await second.getByTestId('sentence-listen-input-submit').click();
    await expect(second).toHaveAttribute('data-status', 'right', { timeout: 15000 });
    await expect(page.getByTestId('sentence-round-counter')).toContainText('2 / 2');
    await shot(page, 'web-03b-listen-retry-right');
    done = true;
  }

  // Skip to the answer (or, 2 / 2 right, it opens by itself): the round's sentences on top, marked.
  if (!done) {
    await page.getByTestId('sentence-round-skip').click();
    await page.getByTestId('sentence-round-skip-yes').click();
  }
  await expect(page.getByTestId('study-card-back')).toBeVisible();
  await expect(page.locator('.sentence-set-row.is-round[data-round="right"]').first()).toBeVisible();
});

test('said back in Chinese with a pause: the recogniser\'s 。 is nothing — right on the device, no check', async ({ page, request }) => {
  test.setTimeout(180_000);
  const { token, deck, note } = await seedBankNote(request);
  await stubSetWithClips(page, note.id);
  await openCard(page, token, deck.id);
  await toTheRound(page);
  const first = page.locator('[data-testid="sentence-round-exercise"][data-mode="listen"]').first();
  await expect(first).toBeVisible({ timeout: 15000 });
  await first.getByTestId('sentence-listen-tap').click();
  const key = (await first.getAttribute('data-exercise'))!.replace('listen:', '');
  const sentence = key.startsWith('clue:') ? CLUE : SET[Number(key.replace('e2e-s', ''))];
  // Jerome's 虾饺 take: a pause in the middle → the recogniser writes 。 and starts a new "sentence".
  const chars = [...sentence.hanzi.replace(/[。？！?.!]$/, '')];
  const mid = Math.floor(chars.length / 2);
  const said = `${chars.slice(0, mid).join('')}。 ${chars.slice(mid).join('')}。`;
  let checked = false;
  page.on('request', (r) => { if (r.url().includes('/api/lessons/answer-check')) checked = true; });
  await hear(page, said);
  await first.getByTestId('sentence-listen-input-say').click();
  await expect(first.getByTestId('sentence-listen-input-live')).toContainText(chars[0], { timeout: 10000 });
  await first.getByTestId('sentence-listen-input-stop').click();
  await first.getByTestId('sentence-listen-input-submit').click();
  await expect(first).toHaveAttribute('data-status', 'right', { timeout: 15000 });
  await expect(first.getByTestId('sentence-listen-headline')).toContainText('You said it back right');
  // "You said" reads like the sentence: the pause's 。 is gone.
  await expect(first.getByTestId('sentence-listen-said')).toContainText(chars.join(''));
  await expect(page.getByTestId('sentence-round-counter')).toContainText('1 / 2');
  expect(checked).toBe(false);
  await shot(page, 'web-05-said-back-with-a-pause');
});

test('settings: "Sentences by ear in Hard mode" off → the round reads and translates', async ({ page, request }) => {
  test.setTimeout(150_000);
  const { token, deck, note } = await seedBankNote(request);
  await page.goto(`/settings?session_token=${token}`);
  const toggle = page.getByTestId('sentences-by-ear-toggle');
  await expect(toggle).toBeChecked({ timeout: 30000 });
  await toggle.scrollIntoViewIfNeeded();
  await shot(page, 'web-04-settings');
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();

  await stubSetWithClips(page, note.id);
  await openCard(page, token, deck.id);
  await toTheRound(page);
  await expect(page.getByTestId('sentence-round-exercise')).toHaveCount(4, { timeout: 15000 });
  await expect(page.locator('[data-testid="sentence-round-exercise"][data-mode="listen"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="sentence-round-exercise"][data-mode="read"]')).toHaveCount(2);
});
