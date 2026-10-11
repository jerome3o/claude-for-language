import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * Voice-first boxes in the mini lessons (docs/STUDY_SESSION.md "Voice-first text boxes"): a typed
 * exercise opens on 🎤 Say it (no keyboard), the words stream in from the live transcriber (Soniox,
 * faked in the page), ⏹ Stop → the review (Retry · Edit · Check), Check runs the exercise's own
 * check — and a spoken homophone (图书管 for 图书馆) is right by sound, like a spoken study answer.
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

async function seedUser(request: APIRequestContext, prefix: string): Promise<string> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const res = await request.post(`${API}/api/test/auth`, { data: { email, name: 'Voice', role: 'tutor' } });
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
  }, [FAKE_WS, text] as const);
  await page.route('**/api/transcribe/live', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      provider: 'soniox', api_key: 'snx_temp_e2e', expires_at: new Date(Date.now() + 1800e3).toISOString(),
      websocket_url: FAKE_WS, model: 'stt-rt-v5', language_hints: ['zh', 'en'],
    }),
  }));
}

test('a typed lesson exercise is voice-first and a spoken homophone is right by sound', async ({ page, request }) => {
  await fakeSoniox(page, '图书管');
  const token = await seedUser(request, 'voice-lesson');
  await page.goto(`/library/catalogue?session_token=${token}`);
  await expect(page.getByRole('heading', { name: /Exercise catalogue/ })).toBeVisible({ timeout: 30000 });
  await page.locator('#type-write_typed').getByRole('link', { name: /Try it/ }).click();
  await expect(page.getByText('Preview · nothing is recorded')).toBeVisible({ timeout: 15000 });

  // Voice first: no keyboard box until ✏️ Type.
  await expect(page.getByTestId('lesson-voice-say')).toBeVisible();
  await expect(page.getByTestId('lesson-voice-text')).toHaveCount(0);

  await page.getByTestId('lesson-voice-say').click();
  await expect(page.getByTestId('lesson-voice-stop')).toBeVisible();
  await expect(page.getByTestId('lesson-voice-live')).toContainText('图书管', { timeout: 10000 });
  await page.getByTestId('lesson-voice-stop').click();

  // The review: what was heard, then Check runs the exercise's own check.
  await expect(page.getByTestId('lesson-voice-review-text')).toHaveText('图书管', { timeout: 10000 });
  await expect(page.getByTestId('lesson-voice-retake')).toBeVisible();
  await expect(page.getByTestId('lesson-voice-edit')).toBeVisible();
  await page.getByTestId('lesson-voice-submit').click();
  await expect(page.getByText('✓ Correct (spoken)')).toBeVisible();
  await expect(page.getByTestId('lesson-spoken-note')).toHaveText('Sounded right ✓ — written 图书馆');
});

test('✏️ Edit puts what was heard in the box — changed, it is checked strictly', async ({ page, request }) => {
  await fakeSoniox(page, '图书管');
  const token = await seedUser(request, 'voice-edit');
  await page.goto(`/library/catalogue?session_token=${token}`);
  await expect(page.getByRole('heading', { name: /Exercise catalogue/ })).toBeVisible({ timeout: 30000 });
  await page.locator('#type-write_typed').getByRole('link', { name: /Try it/ }).click();
  await page.getByTestId('lesson-voice-say').click();
  await page.getByTestId('lesson-voice-stop').click();
  await page.getByTestId('lesson-voice-edit').click();
  const box = page.getByTestId('lesson-voice-text');
  await expect(box).toHaveValue('图书管');
  await expect(page.getByTestId('lesson-voice-mic')).toBeVisible();
  await box.fill('图书官');
  await page.getByTestId('lesson-voice-submit').click();
  await expect(page.locator('.char-diff .extra')).toHaveText('官');
});
