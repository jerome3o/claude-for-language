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

/** `refuse`: Soniox answers the config with an error (402 out of credit) and closes — the live path fails. */
async function fakeSoniox(page: import('@playwright/test').Page, mode: 'ok' | 'refuse' = 'ok') {
  await page.addInitScript(([fakeUrl, fakeMode]) => {
    const Real = window.WebSocket;
    const stats = { config: null as null | Record<string, unknown>, chunks: 0, ended: false, protocols: null as null | string[] };
    (window as unknown as { __soniox: typeof stats }).__soniox = stats;
    class FakeSoniox extends EventTarget {
      readyState = 0;
      onopen: ((e: Event) => void) | null = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      onclose: ((e: CloseEvent) => void) | null = null;
      constructor(public url: string, protocols?: string | string[]) {
        super();
        // Like Soniox since Oct 2026: the key comes WITH the connection (subprotocols
        // 'soniox-api-key' + key), never in the config frame.
        stats.protocols = protocols === undefined ? null : ([] as string[]).concat(protocols);
        setTimeout(() => { this.readyState = 1; this.onopen?.(new Event('open')); }, 20);
      }
      send(data: unknown) {
        if (!stats.config) {
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
              this.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ tokens: [], error_code: 402, error_type: 'organization_balance_exhausted', error_message: 'Balance exhausted' }) }));
              this.readyState = 3;
              this.onclose?.(new CloseEvent('close'));
            }, 20);
          }
          return;
        }
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
      return String(url) === fakeUrl ? new FakeSoniox(String(url), protocols) : new Real(url, protocols);
    } as unknown as typeof WebSocket;
  }, [FAKE_WS, mode] as const);
}

async function routeLiveKey(page: import('@playwright/test').Page) {
  await page.route('**/api/transcribe/live', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      provider: 'soniox', api_key: 'snx_temp_e2e', expires_at: new Date(Date.now() + 1800e3).toISOString(),
      websocket_url: FAKE_WS, model: 'stt-rt-v5', language_hints: ['zh', 'en'],
    }),
  }));
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
        provider: 'soniox', api_key: 'snx_temp_e2e', expires_at: new Date(Date.now() + 1800e3).toISOString(),
        websocket_url: FAKE_WS, model: 'stt-rt-v5', language_hints: ['zh', 'en'],
      }),
    }));
    await page.route(/\/api\/transcribe$/, (route) => { uploads++; return route.fulfill({ json: { text: '是', language: 'zh' } }); });
    await page.gotoAuthenticated('/');
    await page.waitForSelector('.home-study-card');

    await recordOneTake(page);

    await expect(page.getByText(/You said: shì \(是\)/)).toBeVisible({ timeout: 5000 });
    const stats = await page.evaluate(() => (window as unknown as { __soniox: { config: Record<string, unknown>; chunks: number; ended: boolean } }).__soniox);
    expect(stats.config).toMatchObject({ api_key: 'snx_temp_e2e', model: 'stt-rt-v5', audio_format: 'auto' });
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

  /**
   * The bug of 30 Sep 2026: the live stream failed AND the upload failed (Whisper 500), so
   * "Transcribing…" vanished and nothing showed. Now the card says so, the upload carried the
   * live failure reason (the server logs it), and a tap re-sends the SAME saved take.
   */
  test('live and upload both failing shows "Couldn’t transcribe — tap to retry", and the retry re-sends the take', async ({ authenticatedPage: page, testUser, request }) => {
    await request.post('http://localhost:8787/api/decks/starter', { headers: { Authorization: `Bearer ${testUser.sessionToken}` } });
    await fakeSoniox(page, 'refuse');
    await routeLiveKey(page);
    const uploads: Array<{ liveError: string | null; client: string | null; size: number }> = [];
    let failUploads = true;
    await page.route(/\/api\/transcribe$/, async (route) => {
      const body = route.request().postDataBuffer() ?? Buffer.alloc(0);
      const text = body.toString('latin1');
      const field = (name: string) => text.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`))?.[1] ?? null;
      // The file part's bytes: from after its headers to the next boundary.
      const start = text.indexOf('\r\n\r\n', text.indexOf('filename=')) + 4;
      const end = text.indexOf('\r\n--', start);
      uploads.push({ liveError: field('live_error'), client: field('client'), size: end - start });
      if (failUploads) return route.fulfill({ status: 502, json: { error: "Couldn't transcribe the recording", providers: ['whisper'] } });
      return route.fulfill({ json: { text: '是', language: 'zh', provider: 'soniox' } });
    });
    await page.gotoAuthenticated('/');
    await page.waitForSelector('.home-study-card');

    await recordOneTake(page);

    const retry = page.getByTestId('transcription-retry');
    await expect(retry).toBeVisible({ timeout: 8000 });
    await expect(retry).toContainText('Couldn’t transcribe — tap to retry');
    await expect(retry).toContainText('Your recording is saved');
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({ liveError: 'Soniox 402: Balance exhausted', client: 'web' });

    failUploads = false;
    await retry.click();
    await expect(page.getByText(/You said: shì \(是\)/)).toBeVisible({ timeout: 5000 });
    expect(uploads).toHaveLength(2);
    expect(uploads[1].liveError).toBeNull(); // the retry goes straight to the upload
    expect(uploads[1].size).toBe(uploads[0].size); // …with the same saved take
  });
});
