import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * 🎤 Read it aloud on a reader page (docs/STUDY_SESSION.md "Read it aloud"): the 🎤 beside the speed
 * chip records (a fake microphone here), the take is transcribed (the upload path, mocked) and judged
 * against the page — the page's OWN Chinese is marked in place, with one line under the audio and the
 * transcript behind "You said ▸". Practice only: nothing reaches the server but the transcription.
 *
 * READ_ALOUD_SHOTS=<dir> also saves phone-size screenshots there (PR screenshots).
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SHOTS = process.env.READ_ALOUD_SHOTS;

test.use({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

function silentWav(seconds: number, rate = 8000): Buffer {
  const samples = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples * 2, 40);
  return buf;
}
const CLIP = silentWav(0.6);

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function seed(request: APIRequestContext) {
  const email = `read-aloud-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const r = await api<{ reader?: { id: string }; id?: string }>(request, '/api/readers/import', {
    method: 'POST',
    token: auth.session_token,
    data: {
      spec: {
        title_chinese: '小明在巴黎',
        title_english: 'Xiaoming in Paris',
        difficulty_level: 'beginner',
        pages: [
          {
            content_chinese: '小明今天第一次去巴黎。他很兴奋。',
            content_pinyin: 'Xiǎomíng jīntiān dì yī cì qù Bālí. Tā hěn xīngfèn.',
            content_english: 'Today Xiaoming is going to Paris for the first time. He is very excited.',
          },
          { content_chinese: '他喝了一杯咖啡。', content_pinyin: 'Tā hēle yì bēi kāfēi.', content_english: 'He drank a cup of coffee.' },
        ],
      },
    },
  });
  return { token: auth.session_token, readerId: r.reader?.id ?? r.id! };
}

async function openReader(page: Page, token: string, readerId: string) {
  await page.goto(`/?session_token=${token}`);
  await expect.poll(() => page.evaluate((id) => new Promise<boolean>((resolve) => {
    const open = indexedDB.open('ChineseLearningDB');
    open.onerror = () => resolve(false);
    open.onsuccess = () => {
      try {
        const get = open.result.transaction('readers', 'readonly').objectStore('readers').get(id);
        get.onsuccess = () => { resolve(!!get.result); open.result.close(); };
        get.onerror = () => { resolve(false); open.result.close(); };
      } catch { resolve(false); open.result.close(); }
    };
  }), readerId), { timeout: 45_000 }).toBe(true);
  await page.goto(`/readers/${readerId}`);
  await expect(page.getByTestId('reader-view')).toBeVisible({ timeout: 30_000 });
}

test('🎤 Read it aloud: record, then the page is marked in place with one line', async ({ page, request }) => {
  test.setTimeout(150_000);
  const { token, readerId } = await seed(request);
  await page.route('**/api/practice/tts', (route) => route.fulfill({ json: { audio_base64: CLIP.toString('base64'), content_type: 'audio/wav' } }));
  // No live key here: the take is uploaded; the recogniser "heard" a homophone (她), a tone slip (行 for 兴),
  // skipped 很 and added 了.
  await page.route('**/api/transcribe/live', (route) => route.fulfill({ json: { provider: 'upload' } }));
  let transcribed = 0;
  await page.route('**/api/transcribe', (route) => {
    transcribed++;
    return route.fulfill({ json: { text: '小明今天第一次去巴黎了。她行奋。', language: 'zh', provider: 'test' } });
  });
  await openReader(page, token, readerId);

  const mic = page.getByTestId('reader-read-aloud');
  await expect(mic).toHaveAttribute('aria-label', 'Read it aloud');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-reader-page-mic.png` });

  await mic.click();
  await expect(mic).toHaveAttribute('aria-label', 'Stop — check my reading');
  // The Chinese shows while he reads.
  await expect(page.getByTestId('reader-words')).toBeVisible();
  await expect(page.getByTestId('reader-read-aloud-live')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-listening.png` });
  await page.waitForTimeout(1200);
  await mic.click();

  await expect(page.getByTestId('reader-read-aloud-line')).toHaveText('≈ 85% — 3 to check', { timeout: 20_000 });
  expect(transcribed).toBe(1);
  const words = page.getByTestId('reader-words');
  // The page's own text, once — marked, not copied.
  // (the ‸ before 他 is where the extra 了 was said)
  expect((await words.textContent())?.replace('‸', '')).toBe('小明今天第一次去巴黎。他很兴奋。');
  await expect(words.locator('[data-mark="sound"]')).toHaveText('他');
  await expect(words.locator('[data-mark="close"]')).toHaveText('兴');
  await expect(words.locator('[data-mark="missed"]')).toHaveText('很');
  await expect(words.locator('.ra-extra')).toHaveCount(1);
  await expect(page.getByTestId('reader-read-aloud-said')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-marked.png` });

  await page.getByTestId('reader-read-aloud-said-toggle').click();
  await expect(page.getByTestId('reader-read-aloud-said')).toHaveText('小明今天第一次去巴黎了。她行奋。');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/04-you-said.png` });
  await expect(mic).toHaveAttribute('aria-label', 'Say it again');

  // Practice only: the pinyin / translation reveals are untouched.
  await expect(page.getByText('Tap to reveal pinyin')).toBeVisible();
});

test('🎤 offline says it needs a connection and records nothing', async ({ page, request }) => {
  test.setTimeout(120_000);
  const { token, readerId } = await seed(request);
  await page.route('**/api/practice/tts', (route) => route.fulfill({ json: { audio_base64: CLIP.toString('base64'), content_type: 'audio/wav' } }));
  let transcribed = 0;
  await page.route('**/api/transcribe', (route) => { transcribed++; return route.abort(); });
  await openReader(page, token, readerId);
  await page.context().setOffline(true);
  await page.getByTestId('reader-read-aloud').click();
  await expect(page.getByTestId('reader-read-aloud-offline')).toHaveText('Needs a connection to check your reading');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/05-offline.png` });
  await page.context().setOffline(false);
  expect(transcribed).toBe(0);
});
