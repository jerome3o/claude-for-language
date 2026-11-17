import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * Jerome (Nov 2026), a sentence_making exercise with 本来 + 要: he said 我本来要去健身馆，但是我学中文。 and got a green
 * "✓ Natural and correct" over an explanation saying the second half didn't follow and 健身馆 is usually 健身房.
 * docs/STUDY_SESSION.md "Sentence making: an honest verdict": the E2E stand-in grades it ≈ needs work (orange); the
 * unrelated example stays folded; ✨ Show a fixed version comes on tap (his sentence vs the fix) and 🎤 Say it practises
 * it; 🎤 Try again re-checks a new sentence in place → right; Continue scores the FIRST grade (not right first time).
 * SENTENCE_VERDICT_SHOTS=<dir> also saves phone-size screenshots there (PR screenshots).
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
const SHOTS = process.env.SENTENCE_VERDICT_SHOTS;
const FAKE_WS = 'wss://fake-soniox.test/transcribe-websocket';
const FIXED = '我本来要去健身房，可是后来去学中文了。';

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** Soniox stand-in for 🎤 Say it: hears `heard` (final after the end-of-audio frame). */
async function fakeSoniox(page: Page, heard: string) {
  await page.addInitScript(([fakeUrl, text]) => {
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
          if (this.chunks === 2) this.reply({ tokens: [{ text, is_final: false }] });
          return;
        }
        setTimeout(() => {
          this.reply({ tokens: [{ text, is_final: true }, { text: '<fin>', is_final: true }] });
          this.reply({ tokens: [], finished: true });
        }, 30);
      }
      close() { this.readyState = 3; }
    }
    window.WebSocket = function (url: string | URL, protocols?: string | string[]) {
      return String(url) === fakeUrl ? new FakeSoniox(String(url)) : new Real(url, protocols);
    } as unknown as typeof WebSocket;
  }, [FAKE_WS, heard] as const);
  await page.route('**/api/transcribe/live', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      provider: 'soniox', api_key: 'snx_temp_e2e', expires_at: new Date(Date.now() + 1800e3).toISOString(),
      websocket_url: FAKE_WS, model: 'stt-rt-v5', language_hints: ['zh', 'en'],
    }),
  }));
}

const spec = {
  title: '本来 · Originally',
  icon: '🏋️',
  sections: [{
    exercises: [
      {
        type: 'sentence_making',
        words: [{ hanzi: '本来', pinyin: 'běnlái', english: 'originally' }, { hanzi: '要', pinyin: 'yào', english: 'going to' }],
        task: 'Say what you were going to do — and what happened instead.',
        example: { hanzi: '我本来要买那件衣服，后来觉得太贵了。', pinyin: 'Wǒ běnlái yào mǎi nà jiàn yīfu, hòulái juéde tài guì le.', english: 'I was going to buy that piece of clothing, but then I thought it was too expensive.' },
      },
      { type: 'note', title: 'Done', body: 'That was the last one.' },
    ],
  }],
};

async function typeInto(page: Page, prefix: string, text: string) {
  const type = page.getByTestId(`${prefix}-type`);
  if (await type.isVisible().catch(() => false)) await type.click();
  await page.getByTestId(`${prefix}-text`).fill(text);
  await page.getByTestId(`${prefix}-submit`).click();
}

test('本来…要: ≈ needs work (not ✓), the fix on tap with 🎤 Say it, Try again → right, the first grade counts', async ({ page, request }) => {
  await fakeSoniox(page, FIXED);
  const email = `sentence-verdict-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const created = await api<{ lesson: { id: string } } | { id: string }>(request, '/api/custom-lessons', { method: 'POST', token, data: { spec } });
  const id = 'lesson' in created ? created.lesson.id : created.id;
  let fixCalls = 0;
  page.on('request', (r) => { if (r.url().includes('/api/lessons/sentence-fix')) fixCalls++; });

  await page.goto(`/lessons/${id}/play?from=lessons_page&session_token=${token}`);
  await expect(page.getByText('Say what you were going to do')).toBeVisible({ timeout: 30_000 });
  await typeInto(page, 'lesson-voice', '我本来要去健身馆，但是我学中文。');

  // ≈ needs work in orange — the target words used right, the second half doesn't follow.
  const verdict = page.getByTestId('sentence-feedback');
  await expect(verdict).toHaveAttribute('data-grade', 'needs_work', { timeout: 15_000 });
  await expect(page.getByTestId('sentence-feedback-headline')).toHaveText('本来…要 used right — the second half doesn’t follow');
  await expect(page.getByText('Natural and correct')).toHaveCount(0);
  // No duplicate self-check under Claude's verdict; the unrelated example is folded.
  await expect(page.getByText('Is your sentence grammatical, and does it use every word?')).toHaveCount(0);
  await expect(page.getByTestId('sentence-example-toggle')).toBeVisible();
  await expect(page.getByTestId('lesson-feedback-sentence')).toHaveCount(0);
  // Nothing pre-generated.
  expect(fixCalls).toBe(0);
  await expect(page.getByTestId('sentence-fix')).toHaveCount(0);
  await page.mouse.move(0, 0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-01-needs-work.png`, fullPage: true });

  // More ▸ opens the fuller text.
  await page.getByTestId('sentence-feedback-more').click();
  await expect(page.getByTestId('sentence-feedback-full')).toContainText('健身馆 is usually 健身房');

  // ✨ Show a fixed version: his sentence vs the fix, ▶ + pinyin, then 🎤 Say it.
  await page.getByTestId('sentence-show-fix').click();
  await expect(page.getByTestId('sentence-fix-expected')).toContainText(FIXED, { timeout: 15_000 });
  expect(fixCalls).toBe(1);
  await expect(page.getByTestId('sentence-fix-play')).toBeVisible();
  await expect(page.getByTestId('sentence-fix-expected')).toContainText('běnlái');
  await expect(page.getByTestId('sentence-show-fix')).toHaveCount(0);
  await page.getByTestId('lesson-say-fix-row-mic').click();
  const stop = page.getByTestId('take-lock-stop');
  await expect(page.getByTestId('lesson-say-fix-row-live')).toContainText('健身房', { timeout: 10_000 });
  if (await stop.isVisible().catch(() => false)) await stop.click();
  else await page.getByTestId('lesson-say-fix-row-mic').click();
  await expect(page.getByTestId('lesson-say-fix-row-result')).toBeVisible({ timeout: 10_000 });
  await page.mouse.move(0, 0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-02-fix.png`, fullPage: true });

  // 🎤 Try again: a new sentence, checked in place → ✓ right; the actions go.
  await page.getByTestId('sentence-try-again').click();
  await typeInto(page, 'sentence-try-voice', '我本来要去健身房，可是后来下雨了。');
  await expect(page.getByTestId('sentence-retry-feedback')).toHaveAttribute('data-grade', 'right', { timeout: 15_000 });
  await expect(page.getByTestId('sentence-try-again')).toHaveCount(0);
  await expect(page.getByTestId('sentence-feedback')).toHaveAttribute('data-grade', 'needs_work');
  await page.mouse.move(0, 0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-03-try-again-right.png`, fullPage: true });

  // Continue: the first grade counts — the attempt keeps needs work, not "right first time".
  await page.getByTestId('lesson-continue').click();
  await expect(page.getByText('That was the last one.')).toBeVisible({ timeout: 10_000 });
});

test('a paused spoken take is checked as one utterance: 我不知道。 我妹妹有，不有新电脑。', async ({ request }) => {
  const email = `sentence-pause-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const r = await api<{ feedback: { grade: string; headline: string; reason?: string }; sentence: string }>(request, '/api/lessons/sentence-feedback', {
    method: 'POST', token, data: { words: ['不知道', '有没有'], sentence: '我不知道。 我妹妹有，不有新电脑。', input: 'spoken' },
  });
  expect(r.sentence).toBe('我不知道我妹妹有不有新电脑');
  expect(r.feedback.grade).toBe('needs_work');
  expect(`${r.feedback.headline} ${r.feedback.reason ?? ''}`).not.toMatch(/split|separate sentences|punctuation/i);
  // Typed answers keep their punctuation.
  const typed = await api<{ sentence: string }>(request, '/api/lessons/sentence-feedback', {
    method: 'POST', token, data: { words: ['本来', '要'], sentence: '我本来要去健身房，可是后来下雨了。', input: 'typed' },
  });
  expect(typed.sentence).toBe('我本来要去健身房，可是后来下雨了。');
});
