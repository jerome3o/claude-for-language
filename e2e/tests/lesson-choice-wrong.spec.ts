import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * "Which sentence is wrong?" multiple choice (shared/lesson/choiceMistake.ts; docs/STUDY_SESSION.md "Which sentence is
 * wrong?"). Jerome, Nov 2026: "it reads out the audio of the incorrect version of the sentence … it should read out the
 * correct version instead." The answer option IS the mistake: the reveal strikes it, shows "✓ Correct:" + its
 * correction and plays THAT — no TTS request ever carries the wrong sentence (prefetch included):
 * - a lesson with its own `correction`;
 * - an older lesson without one: the device asks POST /api/lessons/choice-correction (the E2E stand-in model);
 * - an older lesson with no connection for it: the mistake has no ▶ and nothing is spoken for it.
 */
test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined } });

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const WRONG = '他了去北京。';
const FIXED = '他去北京了。';

function silentWav(seconds: number, rate = 8000): Buffer {
  const samples = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples * 2, 40);
  return buf;
}

function lessonSpec(correction?: { hanzi: string; pinyin?: string; english?: string }) {
  return {
    title: 'Where does 了 go?',
    icon: '⚖️',
    sections: [{
      exercises: [{
        type: 'choice',
        question: 'Which sentence is wrong?',
        options: [
          { hanzi: '我昨天买了一本书。', pinyin: 'Wǒ zuótiān mǎi le yì běn shū.', english: 'I bought a book yesterday.' },
          { hanzi: WRONG, english: 'He went to Beijing.' },
          { hanzi: '我吃了饭。', pinyin: 'Wǒ chī le fàn.', english: 'I have eaten.' },
        ],
        correct: 1,
        explanation: '了 goes after the verb or at the end, never before the verb.',
        ...(correction ? { correction } : {}),
      }],
    }],
  };
}

async function seedLesson(request: APIRequestContext, spec: unknown): Promise<{ token: string; id: string }> {
  const email = `choice-wrong-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await request.post(`${API}/api/test/auth`, { data: { email, name: 'Jerome' } });
  if (!auth.ok()) throw new Error(`auth ${auth.status()}`);
  const token = ((await auth.json()) as { session_token: string }).session_token;
  const res = await request.post(`${API}/api/custom-lessons`, { headers: { Authorization: `Bearer ${token}` }, data: { spec } });
  if (!res.ok()) throw new Error(`create lesson ${res.status()} ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { lesson?: { id: string }; id?: string };
  return { token, id: body.lesson?.id ?? body.id! };
}

/** Every text the page asked TTS for (answered with silence). */
async function recordTts(page: Page): Promise<string[]> {
  const texts: string[] = [];
  await page.route('**/api/practice/tts', async (route) => {
    try {
      const body = JSON.parse(route.request().postData() ?? '{}') as { text?: string };
      if (body.text) texts.push(body.text);
    } catch { /* not JSON */ }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ audio_base64: silentWav(0.3).toString('base64'), content_type: 'audio/wav' }) });
  });
  return texts;
}

async function pickTheMistake(page: Page) {
  await expect(page.getByText('Which sentence is wrong?').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: WRONG }).click();
  await expect(page.getByText('✓ Correct', { exact: true })).toBeVisible();
  await expect(page.getByTestId('choice-mistake-option')).toContainText(WRONG);
  await expect(page.getByTestId('choice-mistake-option')).toContainText('This sentence has the mistake');
  // The mistake has no ▶ (the right sentences keep theirs).
  await expect(page.getByTestId('choice-mistake-option').getByTestId('lesson-option-replay')).toHaveCount(0);
  await expect(page.getByTestId('lesson-option-replay')).toHaveCount(2);
}

test('a "which is wrong?" choice with its correction plays the correction, never the mistake', async ({ page, request }) => {
  const tts = await recordTts(page);
  const { token, id } = await seedLesson(request, lessonSpec({ hanzi: FIXED, pinyin: 'Tā qù Běijīng le.', english: 'He went to Beijing.' }));
  await page.goto(`/lessons/${id}/play?from=lessons_page&session_token=${token}`);
  await pickTheMistake(page);
  const fix = page.getByTestId('choice-correction');
  await expect(fix).toContainText(FIXED);
  await expect(fix).toContainText('Tā qù Běijīng le.');
  await expect(page.getByText('✓ Correct:')).toBeVisible();
  await expect.poll(() => tts.includes(FIXED), { timeout: 10_000 }).toBe(true);
  const before = tts.length;
  await fix.getByTestId('lesson-replay').click();
  await page.waitForTimeout(500);
  expect(tts.length).toBeGreaterThanOrEqual(before);
  expect(tts).not.toContain(WRONG);
});

test('an older lesson without a correction asks for one and plays it', async ({ page, request }) => {
  const tts = await recordTts(page);
  const asked: unknown[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/lessons/choice-correction')) asked.push(JSON.parse(r.postData() ?? '{}'));
  });
  const { token, id } = await seedLesson(request, lessonSpec());
  await page.goto(`/lessons/${id}/play?from=lessons_page&session_token=${token}`);
  await pickTheMistake(page);
  await expect(page.getByTestId('choice-correction')).toContainText(FIXED, { timeout: 15_000 });
  expect(asked[0]).toMatchObject({ question: 'Which sentence is wrong?', sentence: WRONG });
  // Spoken: the correction, when it arrived — the TTS request text is the correction, never the mistake.
  await expect.poll(() => tts.includes(FIXED), { timeout: 10_000 }).toBe(true);
  expect(tts).not.toContain(WRONG);
});

test('an older lesson with no connection for the correction: no ▶ for the mistake, nothing spoken for it', async ({ page, request }) => {
  const tts = await recordTts(page);
  await page.route('**/api/lessons/choice-correction', (route) => route.abort('internetdisconnected'));
  const { token, id } = await seedLesson(request, lessonSpec());
  await page.goto(`/lessons/${id}/play?from=lessons_page&session_token=${token}`);
  await pickTheMistake(page);
  await expect(page.getByTestId('choice-correction-offline')).toHaveText('The correct version needs a connection.');
  await expect(page.getByTestId('choice-correction')).toHaveCount(0);
  await expect(page.getByTestId('lesson-say-again')).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(tts).not.toContain(WRONG);
  expect(tts).not.toContain(FIXED);
});
