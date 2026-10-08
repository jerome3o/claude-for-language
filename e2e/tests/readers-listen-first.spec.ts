import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * Graded readers are read ONCE, and listened to first (shared/study/daily-reader.ts):
 * - an unread daily reader is offered again in the next session and no new story is
 *   generated while it waits;
 * - "▶ Play whole story" plays page after page, turning the pages, and listening to the
 *   end finishes the story (it is never offered again);
 * - new mini lessons are paced per local day: one a day by default.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

interface SeededUser { id: string; token: string }

/** A 0.4 s silent WAV, so the browser really plays (and ends) each page's narration. */
function silentWav(seconds: number, rate = 8000): Buffer {
  const samples = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples * 2, 40);
  return buf;
}
const CLIP = silentWav(0.4);

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function seedUser(request: APIRequestContext, tag: string): Promise<SeededUser> {
  const email = `listen-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  return { id: r.user.id, token: r.session_token };
}

async function seedReader(request: APIRequestContext, user: SeededUser): Promise<string> {
  const r = await api<{ reader?: { id: string }; id?: string }>(request, '/api/readers/import', {
    method: 'POST',
    token: user.token,
    data: {
      spec: {
        title_chinese: '小明在巴黎',
        title_english: 'Xiaoming in Paris',
        difficulty_level: 'beginner',
        pages: [
          { content_chinese: '小明今天去巴黎。', content_pinyin: 'Xiǎomíng jīntiān qù Bālí.', content_english: 'Today Xiaoming goes to Paris.' },
          { content_chinese: '他喝了一杯咖啡。', content_pinyin: 'Tā hēle yì bēi kāfēi.', content_english: 'He drank a cup of coffee.' },
          { content_chinese: '晚上他很开心。', content_pinyin: 'Wǎnshang tā hěn kāixīn.', content_english: 'In the evening he was happy.' },
        ],
      },
    },
  });
  return r.reader?.id ?? r.id!;
}

/** Open the app and wait until the background sync has put the reader on the device (IndexedDB). */
async function openAndSyncReader(page: Page, user: SeededUser, readerId: string) {
  await page.goto(`/?session_token=${user.token}`);
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
}

/** Page narration: no TTS key locally — answer every /api/practice/tts with the short clip. */
async function mockNarration(page: Page) {
  await page.route('**/api/practice/tts', route => route.fulfill({ json: { audio_base64: CLIP.toString('base64'), content_type: 'audio/wav' } }));
}

test('an unread daily reader is offered again, and no new story is generated while it waits', async ({ page, request }) => {
  test.setTimeout(120_000);
  const user = await seedUser(request, 'unread');
  const readerId = await seedReader(request, user);
  await mockNarration(page);
  const generateCalls: string[] = [];
  page.on('request', req => { if (req.url().includes('/api/daily/reader/generate')) generateCalls.push(req.url()); });
  await openAndSyncReader(page, user, readerId);

  for (let visit = 0; visit < 2; visit++) {
    await page.goto(`/study?autostart=true&session_token=${user.token}`);
    await expect(page.getByText('小明在巴黎').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('reader-play-story')).toBeVisible();
    // Leave without reading it: it is still today's story next time.
    await page.getByRole('button', { name: 'End session' }).click();
  }
  expect(generateCalls).toEqual([]);
});

test('▶ Play whole story turns the pages, and listening to the end finishes the story for good', async ({ page, request }) => {
  test.setTimeout(120_000);
  const user = await seedUser(request, 'play');
  const readerId = await seedReader(request, user);
  await mockNarration(page);
  await openAndSyncReader(page, user, readerId);

  await page.goto(`/study?autostart=true&session_token=${user.token}`);
  await expect(page.getByTestId('reader-play-story')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('study-reader-page-label')).toContainText('Page 1 of 3');
  // A small ▶ at the start of the "Graded Reader" row, named for screen readers.
  await expect(page.getByRole('button', { name: 'Play whole story' })).toBeVisible();
  await page.getByTestId('reader-play-story').click();
  await expect(page.getByTestId('reader-play-story')).toHaveAttribute('aria-label', 'Stop the story');
  await expect(page.getByRole('button', { name: 'Stop the story' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('study-reader-page-label')).toContainText('Page 2 of 3', { timeout: 20_000 });
  await expect(page.getByTestId('study-reader-page-label')).toContainText('Page 3 of 3', { timeout: 20_000 });

  // The end of the last page = read: the finish reaches the server…
  await expect.poll(async () => {
    const r = await api<{ events: Array<{ reader_id: string }> }>(request, '/api/reader-reviews?since=1970-01-01%2000:00:00', { token: user.token });
    return r.events.filter(e => e.reader_id === readerId).length;
  }, { timeout: 30_000 }).toBe(1);

  // …and the story is never offered again.
  await page.goto(`/study?autostart=true&session_token=${user.token}`);
  await page.waitForTimeout(3000);
  await expect(page.getByTestId('reader-play-story')).toHaveCount(0);
});

const lessonSpec = (title: string) => ({
  title,
  icon: '🧳',
  sections: [{
    exercises: [{
      type: 'note',
      title: '去 + place',
      body: '去 + a place = go there: 我去北京。',
      sentences: [{ hanzi: '我去北京。', pinyin: 'Wǒ qù Běijīng.', english: 'I go to Beijing.' }],
    }],
  }],
});

test('one new mini lesson a day: the next one waits for tomorrow', async ({ page, request }) => {
  test.setTimeout(120_000);
  const user = await seedUser(request, 'lessons');
  await api(request, '/api/custom-lessons', { method: 'POST', token: user.token, data: { spec: lessonSpec('China trip 1: the train') } });
  await api(request, '/api/custom-lessons', { method: 'POST', token: user.token, data: { spec: lessonSpec('China trip 2: the hotel') } });

  await page.goto(`/study?autostart=true&session_token=${user.token}`);
  // Both were created in the same second: whichever is the oldest comes first — just one of them.
  const title = page.getByText(/China trip [12]: the (train|hotel)/).first();
  await expect(title).toBeVisible({ timeout: 30_000 });
  const first = (await title.textContent())!.trim();
  const second = first.includes('train') ? 'China trip 2: the hotel' : 'China trip 1: the train';
  await page.getByRole('button', { name: /next|continue|got it/i }).first().click();
  await expect(page.getByText('How well do you know this material now?')).toBeVisible();
  await page.locator('.study-rating-sticky').getByRole('button', { name: /Good/ }).click();
  await expect(page.getByText('How well do you know this material now?')).toBeHidden({ timeout: 15_000 });

  // Neither now nor in a new session today: the second lesson waits.
  await page.goto(`/study?autostart=true&session_token=${user.token}`);
  await page.waitForTimeout(3000);
  await expect(page.getByText(second)).toHaveCount(0);
});
