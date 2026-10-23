import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * Claude checks a free-speaking answer (docs/STUDY_SESSION.md "Claude checks your speaking"):
 * "口语 · Speaking — recorded 🎙" → record → ■ → "🎤 You said" (the take uploaded to /api/transcribe —
 * no live key here) → Done → the speaking check (E2E fake: Jerome's "Annie" answer): the task's four
 * parts with ③ marked, a cleaner version, tips with the better words; ✓ I said it well ringed. And
 * when transcription fails: "Couldn't transcribe — tap to retry" sends the same take again.
 */
test.use({
  permissions: ['microphone'],
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  },
});

const API = process.env.E2E_API_URL || 'http://localhost:8787';

/** services/answer-check-fake.ts SPEAKING_FIXTURE. */
const PROMPT = "A new colleague, Annie, arrives at your office. Guess who she is (① 就是…吧), tell her where two places are (② 就在), what today's meeting is about (③ 是关于…的), and how busy the team is (④ 形容词 + 到…).";
const SAID = '嗯，你好，你就是……sorry，你就是新来的Annie吧？欢迎欢迎！洗手间在……wait，洗手间就在电梯的旁边，打印机就在我的办公桌后面。今天的会议是关于下个月的活动。我们团队最近忙到……忙到没有时间吃午饭了。';

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function seed(request: APIRequestContext, tag: string): Promise<{ token: string; lessonId: string }> {
  const email = `speaking-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const spec = {
    title: 'At the office · 就是…吧',
    icon: '🏢',
    sections: [{
      exercises: [{
        type: 'oral_expression',
        prompt: PROMPT,
        hints: [{ hanzi: '就是', pinyin: 'jiù shì' }, { hanzi: '就在', pinyin: 'jiù zài' }, { hanzi: '关于', pinyin: 'guānyú' }],
        example: { hanzi: '你就是新来的Annie吧？洗手间就在那边。', pinyin: 'Nǐ jiù shì xīn lái de Annie ba? Xǐshǒujiān jiù zài nàbiān.' },
        target_seconds: 60,
      }],
    }],
  };
  const created = await api<{ lesson: { id: string } } | { id: string }>(request, '/api/custom-lessons', { method: 'POST', token: r.session_token, data: { spec } });
  return { token: r.session_token, lessonId: 'lesson' in created ? created.lesson.id : created.id };
}

async function record(page: Page, ms = 1500) {
  await page.getByTestId('speaking-record').click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  await page.waitForTimeout(ms);
  await page.getByRole('button', { name: 'Stop recording' }).click();
}

test('record → "You said" → Done → Claude marks the parts, a cleaner version and tips; I said it well ringed', async ({ page, request }) => {
  test.setTimeout(120_000);
  const { token, lessonId } = await seed(request, 'ok');
  let uploads = 0;
  await page.route('**/api/transcribe/live', (route) => route.fulfill({ json: { provider: 'upload' } }));
  await page.route(/\/api\/transcribe$/, (route) => { uploads++; return route.fulfill({ json: { text: SAID, language: 'zh' } }); });
  await page.goto(`/lessons/${lessonId}/play?from=lessons_page&session_token=${token}`);
  await expect(page.getByText('Guess who she is')).toBeVisible({ timeout: 30_000 });

  await record(page);
  const transcript = page.getByTestId('speaking-transcript');
  await expect(transcript).toContainText('你就是新来的Annie吧', { timeout: 15_000 });
  expect(uploads).toBe(1);
  await page.getByTestId('speaking-done').click();

  const check = page.getByTestId('answer-check');
  await expect(check).toBeVisible({ timeout: 20_000 });
  await expect(check.locator('.answer-check-chip')).toHaveText('✓ Good');
  const parts = page.getByTestId('answer-check-parts').locator('li');
  await expect(parts).toHaveCount(4);
  await expect(parts.nth(2)).toHaveAttribute('data-status', 'used_with_issue');
  await expect(page.getByTestId('answer-check-cleaner')).toContainText('是关于下个月的活动的');
  await expect(page.getByTestId('answer-check-cleaner')).not.toContainText('sorry');
  await expect(check.locator('.answer-check-tip-fix').first()).toContainText('是关于下个月的活动的');
  await expect(page.getByText('One way to say it:')).toBeVisible();
  await expect(page.getByTestId('lesson-got-it')).toHaveClass(/suggested/);
  if (process.env.PR_SHOTS) {
    await page.screenshot({ path: `${process.env.PR_SHOTS}/01-transcribed.png` });
    await check.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.PR_SHOTS}/02-check.png` });
    await page.getByTestId('lesson-got-it').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.PR_SHOTS}/03-buttons.png` });
  }
});

test('transcription failed → "Couldn\'t transcribe — tap to retry" sends the same take again', async ({ page, request }) => {
  test.setTimeout(120_000);
  const { token, lessonId } = await seed(request, 'fail');
  let uploads = 0;
  let fail = true;
  await page.route('**/api/transcribe/live', (route) => route.fulfill({ json: { provider: 'upload' } }));
  await page.route(/\/api\/transcribe$/, (route) => {
    uploads++;
    return fail ? route.fulfill({ status: 502, json: { error: "Couldn't transcribe the recording" } }) : route.fulfill({ json: { text: SAID, language: 'zh' } });
  });
  await page.goto(`/lessons/${lessonId}/play?from=lessons_page&session_token=${token}`);
  await expect(page.getByText('Guess who she is')).toBeVisible({ timeout: 30_000 });
  await record(page);
  const retry = page.getByTestId('speaking-transcript-retry');
  await expect(retry).toContainText('Couldn’t transcribe — tap to retry', { timeout: 15_000 });
  if (process.env.PR_SHOTS) {
    await retry.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.PR_SHOTS}/04-transcription-failed.png` });
  }
  fail = false;
  await retry.click();
  await expect(page.getByTestId('speaking-transcript')).toContainText('你就是新来的Annie吧', { timeout: 15_000 });
  expect(uploads).toBe(2);
});
