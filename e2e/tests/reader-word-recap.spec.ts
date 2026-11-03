import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * 📝 Reader word recap (docs/STUDY_SESSION.md "Reader word recap"): a word chip tapped on page 1 and a
 * word read aloud wrong on page 2 (a fake microphone; the upload path, mocked) → Finish ✓ (the read is
 * recorded as always) → "Story finished ✓ — 📝 Recap 2 words" → the one-off pass in story order → the
 * switches start OFF → one switched on → Done makes ONE card in "From my readers" (the content
 * service's batch) and puts it on Up next; the other word stays out.
 *
 * WORD_RECAP_SHOTS=<dir> also saves phone-size screenshots there (PR screenshots).
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SHOTS = process.env.WORD_RECAP_SHOTS;

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

type SeedPage = { content_chinese: string; content_pinyin: string; content_english: string };

async function seed(request: APIRequestContext, pages?: SeedPage[]) {
  const email = `word-recap-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const r = await api<{ reader?: { id: string }; id?: string }>(request, '/api/readers/import', {
    method: 'POST',
    token: auth.session_token,
    data: {
      spec: {
        title_chinese: '成都的一天',
        title_english: 'A day in Chengdu',
        difficulty_level: 'beginner',
        pages: pages ?? [
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


test('📝 Reader word recap: taps + read-aloud mistakes → recap → only the switched-on word becomes a card', async ({ page, request }) => {
  test.setTimeout(180_000);
  const { token, readerId } = await seed(request, [
    {
      content_chinese: '今天我们在成都，先去春熙路采耳。',
      content_pinyin: 'Jīntiān wǒmen zài Chéngdū, xiān qù Chūnxī Lù cǎi\'ěr.',
      content_english: "Today we're in Chengdu; first we get our ears cleaned on Chunxi Road.",
    },
    { content_chinese: '晚上我们吃麻辣兔头。', content_pinyin: 'Wǎnshang wǒmen chī málà tùtóu.', content_english: 'In the evening we eat spicy rabbit heads.' },
  ]);
  await page.route('**/api/practice/tts', (route) => route.fulfill({ json: { audio_base64: CLIP.toString('base64'), content_type: 'audio/wav' } }));
  await page.route('**/api/transcribe/live', (route) => route.fulfill({ json: { provider: 'upload' } }));
  // Page 2 read aloud: 麻辣 skipped.
  await page.route('**/api/transcribe', (route) => route.fulfill({ json: { text: '晚上我们吃兔头。', language: 'zh', provider: 'test' } }));
  // The card writer (hermetic: no model here).
  await page.route('**/api/ai/gloss-words', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}') as { words: Array<{ hanzi: string; pinyin?: string; english?: string }> };
    return route.fulfill({ json: { words: body.words.map((w) => ({ hanzi: w.hanzi, pinyin: w.pinyin || 'pīnyīn', english: w.english || 'a gloss' })) } });
  });
  await page.route('**/api/ai/enrich-words', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}') as { words: Array<{ hanzi: string }> };
    return route.fulfill({ json: { words: body.words.map((w) => ({ hanzi: w.hanzi, fun_facts: `${w.hanzi}: explained`, sentence_clue: '', sentence_clue_pinyin: '', sentence_clue_translation: '' })) } });
  });
  await openReader(page, token, readerId);

  // Page 1: tap 成都 (→ the explorer), then close the explorer.
  await page.locator('.reader-chinese-reveal-box').click();
  await page.locator('.reader-word-chip', { hasText: /^成都$/ }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  if (await page.getByRole('button', { name: 'Close' }).first().isVisible().catch(() => false)) await page.getByRole('button', { name: 'Close' }).first().click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByTestId('study-reader-page-label')).toContainText('Page 2 of 2');

  // Page 2: read it aloud, 麻辣 missed.
  await page.getByTestId('reader-read-aloud').click();
  await page.waitForTimeout(1200);
  await page.getByTestId('reader-read-aloud-stop-footer').click();
  await expect(page.getByTestId('reader-read-aloud-line')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('reader-finish').click();

  // The read is recorded as before; the offer slides up over the Readers list.
  const offer = page.getByTestId('recap-offer');
  await expect(offer).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('recap-offer-start')).toHaveText('📝 Recap 2 words');
  await expect(offer).toContainText('1 you tapped · 1 you read aloud differently');
  if (SHOTS) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/web-01-offer.png` });
  }
  await page.getByTestId('recap-offer-start').click();

  // Story order: 成都 (page 1) then 麻辣.
  await expect(page.getByTestId('recap-card')).toContainText('成都');
  await expect(page.getByTestId('recap-sentence')).toHaveText('今天我们在成都，先去春熙路采耳。');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-02-card-front.png` });
  await page.getByTestId('recap-show').click();
  await expect(page.getByTestId('recap-why')).toContainText('You tapped it while reading');
  await expect(page.getByTestId('recap-keep-switch')).not.toBeChecked();
  await page.getByTestId('recap-keep').click();
  await expect(page.getByTestId('recap-keep-switch')).toBeChecked();
  await expect(page.getByTestId('recap-keep')).toHaveClass(/is-on/);
  if (SHOTS) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/web-03-card-back.png` });
  }
  await page.getByTestId('recap-not-yet').click();

  await expect(page.getByTestId('recap-card')).toContainText('麻辣');
  await page.getByTestId('recap-show').click();
  await expect(page.getByTestId('recap-why')).toContainText('Read aloud: missed 麻 má');
  await page.getByTestId('recap-got-it').click();
  // 成都 comes back until Got it.
  await expect(page.getByTestId('recap-card')).toContainText('成都');
  await expect(page.getByTestId('recap-retry')).toHaveText('Trying again · 1 left');
  await page.getByTestId('recap-show').click();
  await page.getByTestId('recap-got-it').click();

  // The list: 成都 on (from its card), 麻辣 off.
  await expect(page.getByTestId('recap-summary')).toContainText('1 right first time');
  const switches = page.getByTestId('recap-row-keep-switch');
  await expect(switches).toHaveCount(2);
  await expect(switches.nth(0)).toBeChecked();
  await expect(switches.nth(1)).not.toBeChecked();
  if (SHOTS) {
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/web-04-summary.png` });
  }
  await page.getByTestId('recap-done').click();
  await expect(page.getByTestId('recap-done-line')).toHaveText('1 word added to your long-term review');

  // ONE card, in "From my readers", on Up next.
  await expect.poll(async () => {
    const decks = await api<Array<{ id: string; name: string }>>(request, '/api/decks', { token });
    const deck = decks.find((d) => d.name === 'From my readers');
    if (!deck) return null;
    const full = await api<{ notes: Array<{ hanzi: string; fun_facts?: string; sentence_clue?: string }> }>(request, `/api/decks/${deck.id}`, { token });
    return full.notes.map((n) => `${n.hanzi}|${n.fun_facts}|${n.sentence_clue}`);
  }, { timeout: 20_000 }).toEqual(['成都|成都: explained|今天我们在成都，先去春熙路采耳。']);
  await expect.poll(async () => {
    const upNext = await api<{ up_next: Array<{ hanzi: string; source: string | null }> }>(request, '/api/me/up-next', { token });
    return upNext.up_next.map((u) => [u.hanzi, u.source]);
  }, { timeout: 15_000 }).toEqual([['成都', 'reader_recap']]);

  // Afterwards the Readers list offers the recap again.
  await page.goto('/readers');
  await expect(page.getByTestId('reader-recap-line')).toHaveText('📝 Recap words from last read (2)', { timeout: 20_000 });
});
