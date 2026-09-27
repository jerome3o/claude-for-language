import { test, expect } from './fixtures/auth';

/**
 * Pronunciation takes stream to Soniox while the learner speaks (services/liveTranscription.ts),
 * so "You said" is ready right after Stop; without a live key the take is uploaded to
 * POST /api/transcribe (Whisper) as before. Soniox itself is faked in the page: a
 * WebSocket stand-in that checks the config frame and answers the end-of-audio frame.
 */
test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    // A pre-installed Chromium (the remote container); unset in CI.
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  },
});

const FAKE_WS = 'wss://fake-soniox.test/transcribe-websocket';

async function fakeSoniox(page: import('@playwright/test').Page) {
  await page.addInitScript((fakeUrl) => {
    const Real = window.WebSocket;
    const stats = { config: null as null | Record<string, unknown>, chunks: 0, ended: false };
    (window as unknown as { __soniox: typeof stats }).__soniox = stats;
    class FakeSoniox extends EventTarget {
      readyState = 0;
      onopen: ((e: Event) => void) | null = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      onclose: ((e: CloseEvent) => void) | null = null;
      constructor(public url: string) {
        super();
        setTimeout(() => { this.readyState = 1; this.onopen?.(new Event('open')); }, 20);
      }
      send(data: unknown) {
        if (!stats.config) { stats.config = JSON.parse(String(data)); return; }
        const empty = data === '' || (data instanceof Blob && data.size === 0);
        if (!empty) { stats.chunks++; return; }
        stats.ended = true;
        const reply = (o: object) => this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(o) }));
        setTimeout(() => {
          reply({ tokens: [{ text: '是', is_final: true }, { text: '<fin>', is_final: true }] });
          reply({ tokens: [], finished: true });
        }, 30);
      }
      close() { this.readyState = 3; }
    }
    window.WebSocket = function (url: string | URL, protocols?: string | string[]) {
      return String(url) === fakeUrl ? new FakeSoniox(String(url)) : new Real(url, protocols);
    } as unknown as typeof WebSocket;
  }, FAKE_WS);
}

async function recordOneTake(page: import('@playwright/test').Page) {
  // The starter deck's first new cards are hanzi → meaning (read) cards.
  const record = page.getByRole('button', { name: 'Record Your Pronunciation' });
  await expect(page.getByText(/[1-9]\d* cards? due/)).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: "Study today's cards" }).click();
  await record.waitFor({ timeout: 15000 });
  // The first-card explainer covers the very first card of a new account.
  const gotIt = page.getByRole('button', { name: 'Got it', exact: true });
  await gotIt.click({ timeout: 3000 }).catch(() => {});
  await record.click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stop Recording' }).click();
  await page.getByRole('button', { name: 'Check Answer' }).click();
}

test.describe('Live pronunciation transcription', () => {
  test('streams the take and shows the result without uploading it', async ({ authenticatedPage: page, testUser, request }) => {
    await request.post('http://localhost:8787/api/decks/starter', { headers: { Authorization: `Bearer ${testUser.sessionToken}` } });
    await fakeSoniox(page);
    let uploads = 0;
    await page.route('**/api/transcribe/live', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'soniox', api_key: 'temp:e2e', expires_at: new Date(Date.now() + 1800e3).toISOString(),
        websocket_url: FAKE_WS, model: 'stt-rt-v5', language_hints: ['zh', 'en'],
      }),
    }));
    await page.route(/\/api\/transcribe$/, (route) => { uploads++; return route.fulfill({ json: { text: '是', language: 'zh' } }); });
    await page.gotoAuthenticated('/');
    await page.waitForSelector('.home-study-card');

    await recordOneTake(page);

    await expect(page.getByText(/You said: shì \(是\)/)).toBeVisible({ timeout: 5000 });
    const stats = await page.evaluate(() => (window as unknown as { __soniox: { config: Record<string, unknown>; chunks: number; ended: boolean } }).__soniox);
    expect(stats.config).toMatchObject({ api_key: 'temp:e2e', model: 'stt-rt-v5', audio_format: 'auto' });
    expect(stats.chunks).toBeGreaterThan(1); // streamed while recording, not one blob at the end
    expect(stats.ended).toBe(true);
    expect(uploads).toBe(0);
  });

  test('without a live key the take is uploaded as before', async ({ authenticatedPage: page, testUser, request }) => {
    await request.post('http://localhost:8787/api/decks/starter', { headers: { Authorization: `Bearer ${testUser.sessionToken}` } });
    let uploads = 0;
    await page.route('**/api/transcribe/live', (route) => route.fulfill({ json: { provider: 'upload' } }));
    await page.route(/\/api\/transcribe$/, (route) => { uploads++; return route.fulfill({ json: { text: '是', language: 'zh' } }); });
    await page.gotoAuthenticated('/');
    await page.waitForSelector('.home-study-card');

    await recordOneTake(page);

    await expect(page.getByText(/You said: shì \(是\)/)).toBeVisible({ timeout: 5000 });
    expect(uploads).toBe(1);
  });
});
