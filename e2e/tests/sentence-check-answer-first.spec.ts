import { test, expect, APIRequestContext, Page, Route } from '@playwright/test';
import { skipFirstCardExplainer } from './fixtures/explainer';

/**
 * Sentence answers checked by Claude, the answer first (docs/STUDY_SESSION.md "Sentence answers checked by
 * Claude"; shared/study/sentenceAnswerCheck.ts `sentenceCheckView`). Jerome (Nov 2026, Hard mode, English →
 * Chinese): "I'm not a fan of this loading screen … we see the correct answer straight away and we see the
 * differences straight away, and then it loads the delta" — and "it also corrects my sentence instead of giving
 * me the model answer". So the moment a sentence he typed is checked: the CARD'S answer (hanzi, pinyin, English)
 * and his answer against it, marked, with a slim "Checking your sentence…" row; Claude's verdict then lands
 * under them. Its fix of his wording is never the answer. On a miss, 🎤 Read it again (#722's practice) sits right
 * under "You said": read the card's answer aloud and see it come out right — practice only, the card stays a miss.
 */
test.use({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: process.env.SHOTS_DIR ? 2 : 1,
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  },
});

const SHOTS = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const MODEL = '我早上喝咖啡是为了上班不困。';
const PINYIN = 'Wǒ zǎoshang hē kāfēi shì wèile shàngbān bú kùn.';
const ENGLISH = "I drink coffee in the morning so I'm not sleepy at work.";
const SAID = '我早上喝咖啡，因为工作不困。';
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

const heard = { text: '' };
async function hear(page: Page, text: string) {
  heard.text = text;
  await page.evaluate((h) => { (window as unknown as { __heard?: string }).__heard = h; }, text);
}

test.beforeEach(async ({ context, page }) => {
  await skipFirstCardExplainer(context);
  await fakeSoniox(page);
  await page.route(/\/api\/transcribe$/, (route) => route.fulfill({ json: { text: heard.text, language: 'zh', provider: 'e2e' } }));
});

test('a sentence answer: the card answer and the diff at once, Claude\'s verdict loading in under them', async ({ page, request }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => { try { localStorage.setItem('sentence-gate-v1', 'all'); } catch { /* ignore */ } });
  const email = `answer-first-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Answer first' } });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: '语法句型 · 是为了' } });
  const note = await api<{ id: string }>(request, `/api/decks/${deck.id}/notes?check=none`, {
    method: 'POST', token, data: { hanzi: MODEL, pinyin: PINYIN, english: ENGLISH },
  });
  // Only the English → Chinese card in the queue.
  await api(request, '/api/me/card-holds', { method: 'POST', token, data: { note_ids: [note.id], card_types: ['hanzi_to_meaning', 'audio_to_hanzi'], kind: 'suspend' } });
  await page.route(`**/api/notes/${note.id}/sentences`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const now = new Date().toISOString();
    const sentences = [
      { hanzi: '我学中文是为了跟朋友聊天。', pinyin: 'Wǒ xué Zhōngwén shì wèile gēn péngyou liáotiān.', translation: 'I learn Chinese so I can chat with friends.' },
      { hanzi: '他早起是为了锻炼身体。', pinyin: 'Tā zǎoqǐ shì wèile duànliàn shēntǐ.', translation: 'He gets up early to exercise.' },
    ].map((x, i) => ({ id: `e2e-s${i}`, note_id: note.id, position: i, ...x, audio_url: null, focus: 'core', focus_note: null, explanation: null, created_at: now, updated_at: now }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sentences }) });
  });
  await page.route('**/api/sentences/top-up', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"queued":0,"note_ids":[]}' }));
  // Claude's check, held until released (E2E never reaches a model).
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const checks: unknown[] = [];
  await page.route('**/api/lessons/answer-check', async (route: Route) => {
    checks.push(route.request().postDataJSON());
    await held;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        check: {
          verdict: 'almost',
          headline: 'Clear meaning — but 因为 gives a reason, not a purpose.',
          corrected: '我早上喝咖啡，所以上班不困。',
          corrected_pinyin: 'Wǒ zǎoshang hē kāfēi, suǒyǐ shàngbān bú kùn.',
          tips: [
            { text: 'Use 是为了 for “so that / in order to” — 因为 means “because”.', quote: '因为' },
            { text: '上班 is “being at work”; 工作 is the job itself.', quote: '工作' },
          ],
          suggested: 'missed_it',
        },
        cached: false,
        ms: 900,
      }),
    });
  });

  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('语法句型 · 是为了').first()).toBeVisible({ timeout: 30000 });
  const type = page.getByRole('button', { name: 'Type the answer' }).first();
  await expect(async () => {
    await page.goto(`/study?deck=${deck.id}&autostart=true`);
    await expect(type).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 60000 });
  await type.click();
  await page.locator('.study-typing-input').fill(SAID);
  await page.locator('.study-typing-input').press('Enter');

  // At once, while Claude reads it: the card's answer + his answer against it, a slim checking row — no spinner.
  const feedback = page.getByTestId('hard-feedback');
  await expect(feedback).toHaveAttribute('data-result', 'checking', { timeout: 15000 });
  await expect(feedback).toHaveAttribute('data-answer-first', 'true');
  await expect(page.getByTestId('difference-model')).toContainText('The answer');
  await expect(page.getByTestId('difference-model')).toContainText(MODEL);
  await expect(page.getByTestId('difference-model')).toContainText(PINYIN);
  await expect(page.getByTestId('difference-model-english')).toHaveText(ENGLISH);
  await expect(page.getByTestId('difference-said')).toContainText(SAID);
  await expect(page.locator('[data-testid="difference-said"] [data-mark="wrong"]').first()).toBeVisible();
  await expect(page.getByTestId('hard-sentence-checking')).toContainText('Checking your sentence…');
  await expect(feedback.locator('.spinner')).toHaveCount(0);
  expect(checks).toHaveLength(1);
  await shot(page, '02-web-answer-first-checking');

  // The verdict lands under them: ≈ Nearly, the tips; Claude's fix of HIS wording only as a small line.
  release();
  await expect(feedback).toHaveAttribute('data-result', 'close', { timeout: 15000 });
  await expect(page.getByTestId('answer-check')).toHaveAttribute('data-verdict', 'almost');
  await expect(page.getByTestId('difference-model')).toContainText(MODEL);
  await expect(page.getByTestId('hard-sentence-your-fix')).toContainText('Your wording, fixed:');
  await expect(page.getByTestId('hard-sentence-checking')).toHaveCount(0);
  await expect(page.getByTestId('hard-try-again')).toBeVisible();
  await expect(page.getByTestId('hard-show-answer')).toContainText('Continue to the sentences');
  await expect(page.getByTestId('study-card-back')).toHaveCount(0);
  await shot(page, '03-web-verdict-landed');

  // 🎤 Read it again, right under "You said": read the card's answer aloud — right this time, practice only.
  const mic = page.getByTestId('hard-read-again-mic');
  await expect(mic).toContainText('Read it aloud');
  await hear(page, MODEL);
  await mic.click();
  await expect(page.getByTestId('hard-read-again-live')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1200);
  await mic.click();
  const readResult = page.getByTestId('hard-read-again-result');
  await expect(readResult).toHaveAttribute('data-result', 'right', { timeout: 15000 });
  await expect(readResult).toContainText('Practice only — this card still counts as a miss.');
  await expect(feedback).toHaveAttribute('data-result', 'close');
  await page.getByTestId('hard-read-again').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shot(page, '04-web-read-again-right');

  // Moving on = giving up (a miss), straight on to the round — the answer was on screen already.
  await page.getByTestId('hard-show-answer').click();
  await expect(page.getByTestId('sentence-round')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('hard-revealed-answer')).toHaveCount(0);
});
