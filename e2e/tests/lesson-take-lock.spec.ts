import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * The take lock in the mini-lesson player (shared/voice/takeLock.ts; docs/STUDY_SESSION.md "Mini lessons" →
 * "Feedback"). Jerome: on a word-order exercise, after Check he pressed 🎤 Say it again, then tapped what he thought
 * finished the recording — it was Continue, and the lesson skipped on. Now, while the take records, Continue IS
 * "■ Stop recording": tapping it stops the take (checked as before) and stays; only then does Continue come back.
 *
 * Also the answer screen's sentence: every word opens the language explorer, ▶ plays the clip again.
 *
 * TAKE_LOCK_SHOTS=<dir> also saves phone-size screenshots there (PR screenshots).
 */
test.use({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  },
});

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const FAKE_WS = 'wss://fake-soniox.test/transcribe-websocket';
const SHOTS = process.env.TAKE_LOCK_SHOTS;

function silentWav(seconds: number, rate = 8000): Buffer {
  const samples = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples * 2, 40);
  return buf;
}

async function seedUser(request: APIRequestContext): Promise<string> {
  const email = `take-lock-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const res = await request.post(`${API}/api/test/auth`, { data: { email, name: 'Jerome' } });
  if (!res.ok()) throw new Error(`auth ${res.status()}`);
  return ((await res.json()) as { session_token: string }).session_token;
}

/** Soniox stand-in: hears `text` (interim after two chunks, final after the end-of-audio frame). */
async function fakeSoniox(page: Page, text: string) {
  await page.addInitScript(([fakeUrl, heard]) => {
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
      private reply(o: object) { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(o) })); }
      send(data: unknown) {
        if (!this.configured) { this.configured = true; return; }
        if (data !== '') {
          this.chunks++;
          if (this.chunks === 2) this.reply({ tokens: [{ text: heard, is_final: false }] });
          return;
        }
        setTimeout(() => {
          this.reply({ tokens: [{ text: heard, is_final: true }, { text: '<fin>', is_final: true }] });
          this.reply({ tokens: [], finished: true });
        }, 30);
      }
      close() { this.readyState = 3; }
    }
    window.WebSocket = function (url: string | URL, protocols?: string | string[]) {
      return String(url) === fakeUrl ? new FakeSoniox(String(url)) : new Real(url, protocols);
    } as unknown as typeof WebSocket;
    // Count every clip played (the one audio player's element).
    const w = window as unknown as { __plays: string[] };
    w.__plays = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      w.__plays.push(this.currentSrc || this.src);
      return play.call(this);
    };
  }, [FAKE_WS, text] as const);
  await page.route('**/api/transcribe/live', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      provider: 'soniox', api_key: 'snx_temp_e2e', expires_at: new Date(Date.now() + 1800e3).toISOString(),
      websocket_url: FAKE_WS, model: 'stt-rt-v5', language_hints: ['zh', 'en'],
    }),
  }));
  await page.route('**/api/practice/tts', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ audio_base64: silentWav(0.4).toString('base64'), content_type: 'audio/wav' }),
  }));
}

const plays = (page: Page) => page.evaluate(() => (window as unknown as { __plays: string[] }).__plays.length);

test('word order: while 🎤 Say it again records, Continue is ■ Stop recording — it stops the take and never skips', async ({ page, request }) => {
  await fakeSoniox(page, '我把作业做完了');
  const token = await seedUser(request);
  await page.goto(`/library/catalogue?session_token=${token}`);
  await expect(page.getByRole('heading', { name: /Exercise catalogue/ })).toBeVisible({ timeout: 30000 });
  await page.locator('#type-scramble').getByRole('link', { name: /Try it/ }).click();
  await expect(page.getByText('Preview · nothing is recorded')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('I finished my homework.')).toHaveCount(0); // the English starts hidden

  // Build 我 把 作业 做完了 from the blocks, then Check.
  for (const tile of ['我', '把', '作业', '做完了']) {
    await page.locator('.scramble-row.pool .tile:not(.ghost)', { hasText: new RegExp(`^${tile}$`) }).click();
  }
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByTestId('lesson-result-banner')).toContainText('Correct');

  // The answer screen's sentence: a word opens the explorer; ▶ plays the clip again (as often as he likes).
  const sentence = page.getByTestId('scramble-correct-sentence');
  await expect(sentence.getByTestId('explorable-text')).toBeVisible();
  await expect(page.getByTestId('scramble-answer-tile')).toHaveCount(4);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-scramble-checked.png` });
  await sentence.locator('.xt-tap').first().click();
  await expect(page.getByTestId('explorer')).toBeVisible();
  await page.getByTestId('explorer-close').click();
  await expect(page.getByTestId('explorer')).toHaveCount(0);
  const before = await plays(page);
  await page.getByTestId('lesson-replay').click();
  await expect.poll(() => plays(page)).toBeGreaterThan(before);
  await page.getByTestId('lesson-replay').click();
  await expect.poll(() => plays(page)).toBeGreaterThan(before + 1);

  // 🎤 Say it again: while it records, the Continue button is ■ Stop recording (and ▶ waits).
  const continueBtn = page.getByRole('button', { name: 'Continue', exact: true });
  await expect(continueBtn).toBeVisible();
  await page.getByTestId('lesson-say-again-row-mic').click();
  const stop = page.getByTestId('take-lock-stop');
  await expect(stop).toBeVisible();
  await expect(stop).toHaveText(/Stop recording/);
  await expect(continueBtn).toHaveCount(0);
  await expect(page.getByTestId('lesson-replay')).toBeDisabled();
  await expect(page.getByTestId('lesson-say-again-row-live')).toContainText('我把作业做完了', { timeout: 10000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-recording-stop-button.png` });

  // Tapping where Continue was stops the take — the lesson stays on this exercise, the take is checked.
  await stop.click();
  await expect(page.getByTestId('lesson-say-again-row-result')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('scramble-correct-sentence')).toBeVisible();
  await expect(page.getByTestId('take-lock-stop')).toHaveCount(0);
  await expect(continueBtn).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-after-stop.png` });

  // Only now does Continue move on (the second word-order exercise).
  await continueBtn.click();
  await expect(page.getByTestId('scramble-correct-sentence')).toHaveCount(0);
  await expect(page.locator('.scramble-row.pool .tile', { hasText: /^关上$/ })).toBeVisible();
});

test('✕ while a take records stops the take and stays on the exercise', async ({ page, request }) => {
  await fakeSoniox(page, '我把作业做完了');
  const token = await seedUser(request);
  await page.goto(`/library/catalogue?session_token=${token}`);
  await expect(page.getByRole('heading', { name: /Exercise catalogue/ })).toBeVisible({ timeout: 30000 });
  await page.locator('#type-scramble').getByRole('link', { name: /Try it/ }).click();
  for (const tile of ['我', '把', '作业', '做完了']) {
    await page.locator('.scramble-row.pool .tile:not(.ghost)', { hasText: new RegExp(`^${tile}$`) }).click();
  }
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await page.getByTestId('lesson-say-again-row-mic').click();
  await expect(page.getByTestId('take-lock-stop')).toBeVisible();
  await page.getByRole('button', { name: 'Close preview' }).click();
  await expect(page.getByTestId('take-lock-stop')).toHaveCount(0);
  await expect(page.getByTestId('scramble-correct-sentence')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
});
