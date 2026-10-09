import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * Say the answer on a typing card (docs/STUDY_SESSION.md "Say the answer"): 🎤 streams to the
 * live transcriber (Soniox, faked in the page), the transcript shows in the box as it is
 * spoken, 🎤 again stops it and the answer is submitted at once. A homophone (油 for 由) is
 * right by sound; the review keeps the transcript as its answer and the take as its recording.
 * Live AND upload failing: "Couldn't transcribe — tap to retry", nothing submitted.
 */
test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  },
});

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const FAKE_WS = 'wss://fake-soniox.test/transcribe-websocket';

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/**
 * Soniox stand-in: interim 油 while audio arrives, the final 油 after the end-of-audio frame. `refuse`
 * errors at once. `texts`: what each take in turn hears (the last one repeats) — default 油.
 */
async function fakeSoniox(page: Page, mode: 'ok' | 'refuse' = 'ok', texts: string[] = ['油']) {
  await page.addInitScript(([fakeUrl, fakeMode, heard]) => {
    const Real = window.WebSocket;
    const stats = { chunks: 0, ended: false, takes: 0, config: null as null | Record<string, unknown>, protocols: null as null | string[] };
    (window as unknown as { __soniox: typeof stats }).__soniox = stats;
    class FakeSoniox extends EventTarget {
      readyState = 0;
      onopen: ((e: Event) => void) | null = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      onclose: ((e: CloseEvent) => void) | null = null;
      private text: string;
      private configured = false;
      private chunks = 0;
      constructor(public url: string, protocols?: string | string[]) {
        super();
        this.text = (heard as string[])[Math.min(stats.takes, (heard as string[]).length - 1)];
        stats.takes++;
        // Like Soniox since Oct 2026: the key comes WITH the connection (subprotocols
        // 'soniox-api-key' + key), never in the config frame.
        stats.protocols = protocols === undefined ? null : ([] as string[]).concat(protocols);
        setTimeout(() => { this.readyState = 1; this.onopen?.(new Event('open')); }, 20);
      }
      private reply(o: object) { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(o) })); }
      send(data: unknown) {
        if (!this.configured) {
          this.configured = true; // the first frame of a connection is its config
          stats.config = JSON.parse(String(data));
          const authed = stats.protocols?.[0] === 'soniox-api-key' && !!stats.protocols[1];
          if (!authed || 'api_key' in stats.config!) {
            setTimeout(() => {
              this.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ tokens: [], error_code: 401, error_message: 'key not sent with the connection' }) }));
              this.readyState = 3;
              this.onclose?.(new CloseEvent('close'));
            }, 20);
            return;
          }
          if (fakeMode === 'refuse') {
            setTimeout(() => {
              this.reply({ tokens: [], error_code: 402, error_message: 'Balance exhausted' });
              this.readyState = 3;
              this.onclose?.(new CloseEvent('close'));
            }, 20);
          }
          return;
        }
        if (data !== '') {
          stats.chunks++;
          this.chunks++;
          if (this.chunks === 2) this.reply({ tokens: [{ text: this.text, is_final: false }] });
          return;
        }
        stats.ended = true;
        setTimeout(() => {
          this.reply({ tokens: [{ text: this.text, is_final: true }, { text: '<fin>', is_final: true }] });
          this.reply({ tokens: [], finished: true });
        }, 30);
      }
      close() { this.readyState = 3; }
    }
    window.WebSocket = function (url: string | URL, protocols?: string | string[]) {
      return String(url) === fakeUrl ? new FakeSoniox(String(url), protocols) : new Real(url, protocols);
    } as unknown as typeof WebSocket;
  }, [FAKE_WS, mode, texts] as const);
  await page.route('**/api/transcribe/live', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      provider: 'soniox', api_key: 'snx_temp_e2e', expires_at: new Date(Date.now() + 1800e3).toISOString(),
      websocket_url: FAKE_WS, model: 'stt-rt-v5', language_hints: ['zh', 'en'],
    }),
  }));
}

/** Review events on this device, newest last, with whether a recording is queued / was uploaded for them. */
async function localReviews(page: Page): Promise<Array<{ id: string; card_type: string; user_answer: string | null; recording: boolean }>> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('ChineseLearningDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const idb = open.result;
      const tx = idb.transaction(['reviewEvents', 'cards', 'pendingRecordings'], 'readonly');
      const events = tx.objectStore('reviewEvents').getAll();
      const cards = tx.objectStore('cards').getAll();
      const recs = tx.objectStore('pendingRecordings').getAllKeys();
      tx.oncomplete = () => {
        const typeOf = new Map((cards.result as Array<{ id: string; card_type: string }>).map(c => [c.id, c.card_type]));
        const withRec = new Set(recs.result as string[]);
        resolve((events.result as Array<{ id: string; card_id: string; user_answer: string | null; reviewed_at: string }>)
          .sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at))
          .map(e => ({ id: e.id, card_type: typeOf.get(e.card_id) ?? '?', user_answer: e.user_answer, recording: withRec.has(e.id) })));
      };
    };
  }));
}

/** Rate read cards Good until a typing card (with its 🎤) is up. */
async function nextTypingCard(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  const skip = page.getByTestId('skip-recording');
  const mic = page.getByTestId('spoken-mic');
  const nothingDue = page.getByText('Nothing due right now');
  const studyUrl = page.url();
  for (let i = 0; i < 10; i++) {
    await expect(skip.or(mic).or(nothingDue).first()).toBeVisible({ timeout: 20000 });
    // The session can be built before the first sync has every card of the note on the device:
    // the other card types come up once Study is opened again.
    if (await nothingDue.isVisible().catch(() => false)) {
      await page.goto(studyUrl);
      continue;
    }
    if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
    if (await mic.isVisible().catch(() => false)) {
      // A listen card first tries to build multiple-choice options (they fail without an AI key
      // here) and falls back to typing: wait for that to settle before using the 🎤.
      await page.waitForTimeout(300);
      await expect(page.getByText('Generating options...')).toHaveCount(0, { timeout: 15000 });
      await expect(mic).toBeVisible();
      return;
    }
    await page.waitForTimeout(500);
    if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
    // Between cards (or a listen card still building its options): look again.
    if (!(await skip.isVisible().catch(() => false))) continue;
    await skip.click();
    await page.getByRole('button', { name: /^Good/ }).first().click();
    await page.waitForTimeout(800);
  }
  await expect(mic).toBeVisible();
}

async function seed(page: Page, request: APIRequestContext) {
  const email = `speak-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Speaker' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: '说出答案' } });
  await api(request, `/api/decks/${deck.id}/notes`, { method: 'POST', token, data: { hanzi: '由', pinyin: 'yóu', english: 'from; by' } });
  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('说出答案').first()).toBeVisible({ timeout: 30000 });
  await page.goto(`/study?deck=${deck.id}&autostart=true`);
}

test.describe.configure({ timeout: 90000 });

test('say the answer: live text in the box, auto-submitted, a homophone is right by sound, the take is kept', async ({ page, request }) => {
  await fakeSoniox(page);
  let uploads = 0;
  await page.route(/\/api\/transcribe$/, (route) => { uploads++; return route.fulfill({ json: { text: '油', language: 'zh' } }); });
  await seed(page, request);

  await nextTypingCard(page);
  await page.getByTestId('spoken-mic').click();
  // Live: the provisional 油 shows in the box while speaking.
  await expect(page.getByTestId('spoken-live')).toContainText('油', { timeout: 10000 });
  await expect(page.getByTestId('spoken-cancel')).toBeVisible();
  await page.getByTestId('spoken-mic').click(); // ⏹ stop → submitted

  const sound = page.getByTestId('spoken-answer-sound');
  await expect(sound).toBeVisible({ timeout: 8000 });
  await expect(sound).toContainText('Sounded right ✓ — written 由');
  await expect(sound).toContainText('You said: 油');
  expect(uploads).toBe(0);
  const stats = await page.evaluate(() => (window as unknown as { __soniox: { config: Record<string, unknown>; ended: boolean } }).__soniox);
  expect(stats.config).not.toHaveProperty('context'); // the answer never biases the recogniser
  expect(stats.ended).toBe(true);

  await page.getByRole('button', { name: /^Good/ }).first().click();
  await expect.poll(async () => (await localReviews(page)).filter(r => r.card_type !== 'hanzi_to_meaning').length, { timeout: 10000 }).toBe(1);
  const typed = (await localReviews(page)).find(r => r.card_type !== 'hanzi_to_meaning')!;
  expect(typed.user_answer).toBe('油');
  expect(typed.recording).toBe(true);
});

test('live and upload both failing: "Couldn’t transcribe — tap to retry", nothing submitted, the retry fills it', async ({ page, request }) => {
  await fakeSoniox(page, 'refuse');
  let fail = true;
  await page.route(/\/api\/transcribe$/, (route) => (fail
    ? route.fulfill({ status: 502, json: { error: "Couldn't transcribe the recording" } })
    : route.fulfill({ json: { text: '由', language: 'zh' } })));
  await seed(page, request);

  await nextTypingCard(page);
  await page.getByTestId('spoken-mic').click();
  await page.waitForTimeout(1200);
  await page.getByTestId('spoken-mic').click();
  const retry = page.getByTestId('spoken-retry');
  await expect(retry).toBeVisible({ timeout: 10000 });
  // Not submitted: still the question (voice first), and typing is one tap away.
  await expect(page.getByTestId('study-voice-first')).toBeVisible();
  await expect(page.getByTestId('spoken-type')).toBeVisible();

  fail = false;
  await retry.click();
  await expect(page.getByTestId('typed-answer-diff').or(page.locator('.answer-diff')).first()).toBeVisible({ timeout: 8000 });
});

test('voice first: one row — ✏️ Type, 👁 Show answer, the wide 🎤 Say it — no box and no keyboard; ✏️ Type opens the box for this card only', async ({ page, request }) => {
  await fakeSoniox(page);
  await seed(page, request);

  await nextTypingCard(page);
  await expect(page.getByTestId('study-voice-first')).toBeVisible();
  const say = page.getByRole('button', { name: 'Say it', exact: true });
  const type = page.getByRole('button', { name: 'Type the answer' });
  const show = page.getByRole('button', { name: 'Show answer', exact: true });
  await expect(say).toBeVisible();
  await expect(type).toBeVisible();
  await expect(show).toBeVisible();
  // One row: Type and Show answer on the left, Say it (the widest) on the right, all the same height.
  const [sb, tb, hb] = [await say.boundingBox(), await type.boundingBox(), await show.boundingBox()];
  expect(tb!.x).toBeLessThan(hb!.x);
  expect(hb!.x).toBeLessThan(sb!.x);
  expect(sb!.width).toBeGreaterThan(hb!.width);
  expect(Math.abs(sb!.y - tb!.y)).toBeLessThan(2);
  expect(Math.abs(sb!.height - hb!.height)).toBeLessThan(2);
  expect(sb!.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByPlaceholder(/Type/)).toHaveCount(0);
  // Nothing focused that would pop the keyboard up.
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');

  await page.getByTestId('spoken-type').click();
  const box = page.getByPlaceholder(/Type/);
  await expect(box).toBeFocused();
  await expect(page.getByTestId('spoken-mic')).toBeVisible(); // the small 🎤 beside the box
  await expect(page.locator('.study-voice-say')).toHaveCount(0);
  await box.fill('由');
  await box.press('Enter');
  await expect(page.locator('.answer-diff').first()).toBeVisible();
  await page.getByRole('button', { name: /^Good/ }).first().click();
  // The next typing card (if any) opens voice first again.
  const next = page.getByTestId('study-voice-first').or(page.getByTestId('skip-recording')).or(page.getByText(/All done|Nothing due/));
  await expect(next.first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByPlaceholder(/Type/)).toHaveCount(0);
});

test('auto-submit off: the transcript fills the box, Enter submits it', async ({ page, request }) => {
  await page.addInitScript(() => { try { localStorage.setItem('spoken-answer-auto-submit-v1', '0'); } catch { /* */ } });
  await fakeSoniox(page);
  await seed(page, request);

  await nextTypingCard(page);
  await page.getByTestId('spoken-mic').click();
  await expect(page.getByTestId('spoken-live')).toContainText('油', { timeout: 10000 });
  await page.getByTestId('spoken-mic').click();
  const box = page.getByPlaceholder(/Type/);
  await expect(box).toHaveValue('油', { timeout: 8000 });
  await expect(page.getByRole('button', { name: 'Check Answer' })).toBeVisible();
  await box.press('Enter');
  await expect(page.getByTestId('spoken-answer-sound')).toBeVisible();
});

/**
 * Counts what the card plays: its clip (any <audio>) or the device voice reading the word (no clip
 * in the test, none being made — "Audio coming…" would make it wait).
 */
async function countCardPlays(page: Page) {
  await page.route('**/api/notes/*/ensure-audio', (route) => route.abort());
  await page.addInitScript(() => {
    const w = window as unknown as { __cardPlays: string[] };
    w.__cardPlays = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      w.__cardPlays.push(this.src);
      return play.call(this);
    };
    if ('speechSynthesis' in window) {
      const speak = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.speechSynthesis.speak = (u: SpeechSynthesisUtterance) => { w.__cardPlays.push(`tts:${u.text}`); speak(u); };
    }
  });
}
const cardPlays = (page: Page) => page.evaluate(() => (window as unknown as { __cardPlays: string[] }).__cardPlays.length);

test('say it again: the question while the new take is said, the NEW verdict after, the clip once; cancel keeps the answer', async ({ page, request }) => {
  // The first take hears 油 (right by sound), the second 由 (exact), the third (cancelled) 有.
  await fakeSoniox(page, 'ok', ['油', '由', '有']);
  await countCardPlays(page);
  await seed(page, request);

  await nextTypingCard(page);
  await page.getByTestId('spoken-mic').click();
  await expect(page.getByTestId('spoken-live')).toContainText('油', { timeout: 10000 });
  await page.getByTestId('spoken-mic').click();
  await expect(page.getByTestId('spoken-answer-sound')).toContainText('You said: 油', { timeout: 8000 });
  // The reveal's auto-play has happened; from here on only "Say it again" may add one.
  await expect.poll(() => cardPlays(page)).toBeGreaterThan(0);
  await page.waitForTimeout(800);
  const afterReveal = await cardPlays(page);

  // Say it again: the question with the live box; the old verdict is out of sight.
  await page.getByTestId('spoken-say-again').click();
  await expect(page.getByTestId('study-sayagain')).toBeVisible();
  await expect(page.getByTestId('study-card-back')).toBeHidden();
  await expect(page.getByTestId('spoken-answer-sound')).toBeHidden();
  await expect(page.getByTestId('spoken-live')).toContainText('由', { timeout: 10000 });
  expect(await cardPlays(page)).toBe(afterReveal);
  await page.getByTestId('spoken-mic').click(); // ⏹

  // The answer again, with the NEW verdict (exact — no "sounded right" note), and the clip once.
  await expect(page.getByTestId('study-card-back')).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId('study-sayagain')).toHaveCount(0);
  await expect(page.getByTestId('spoken-answer-sound')).toHaveCount(0);
  await expect(page.locator('.answer-diff').first()).toBeVisible();
  await expect.poll(() => cardPlays(page)).toBe(afterReveal + 1);
  await page.waitForTimeout(1000);
  expect(await cardPlays(page)).toBe(afterReveal + 1);

  // Say it again → ✕ Cancel: back to the answer, the 由 result unchanged, nothing played.
  await page.getByTestId('spoken-say-again').click();
  await expect(page.getByTestId('spoken-live')).toContainText('有', { timeout: 10000 });
  await page.getByTestId('spoken-cancel').click();
  await expect(page.getByTestId('study-card-back')).toBeVisible();
  await expect(page.getByTestId('spoken-answer-sound')).toHaveCount(0);
  await expect(page.locator('.answer-diff-spoken-note--close')).toHaveCount(0);
  await page.waitForTimeout(800);
  expect(await cardPlays(page)).toBe(afterReveal + 1);

  // The review keeps the latest answer and a recording.
  await page.getByRole('button', { name: /^Good/ }).first().click();
  await expect.poll(async () => (await localReviews(page)).filter(r => r.card_type !== 'hanzi_to_meaning').length, { timeout: 10000 }).toBe(1);
  const typed = (await localReviews(page)).find(r => r.card_type !== 'hanzi_to_meaning')!;
  expect(typed.user_answer).toBe('由');
  expect(typed.recording).toBe(true);
});
