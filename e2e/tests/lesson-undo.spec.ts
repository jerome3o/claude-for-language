import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * ↺ Undo in the mini lesson player (docs/STUDY_SESSION.md "Mini lessons" → "Undo";
 * shared/study/lessonRun.ts `undoRun`): Jerome tapped "✓ Got it" on a "Say it in Chinese" he had
 * wrong. ↺ brings the translation back on its ANSWER side with what he typed, he grades it "✗ Missed
 * it", it is owed in the retry round, and the completion's outcome has it missed. An auto-checked
 * exercise comes back fresh.
 */
test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined } });

const API = process.env.E2E_API_URL || 'http://localhost:8787';

interface SeededUser { id: string; token: string }

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function seedUser(request: APIRequestContext): Promise<SeededUser> {
  const email = `lesson-undo-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  return { id: r.user.id, token: r.session_token };
}

const spec = {
  title: '有点儿 · 一点儿',
  icon: '☕',
  sections: [{
    exercises: [
      { type: 'translate', english: 'I put a little sugar in the coffee.', reference_hanzi: '我在咖啡里放了一点儿糖。', reference_pinyin: 'Wǒ zài kāfēi lǐ fàng le yìdiǎnr táng.' },
      { type: 'choice', question: 'Which one means "a bit expensive"?', options: [{ hanzi: '有点儿贵' }, { hanzi: '一点儿贵' }], correct: 0 },
    ],
  }],
};

type Lessons = { lessons: Array<{ id: string; completions?: Array<{ outcome: { keys: string[]; missed: string[] } | null }> }> };

async function outcomes(request: APIRequestContext, user: SeededUser, id: string) {
  const list = await api<Lessons>(request, '/api/custom-lessons?status=all', { token: user.token });
  return (list.lessons.find(l => l.id === id)?.completions ?? []).map(c => c.outcome);
}

async function typeAnswer(page: Page, text: string) {
  const type = page.getByTestId('lesson-voice-type');
  if (await type.isVisible().catch(() => false)) await type.click();
  await page.getByTestId('lesson-voice-text').fill(text);
  await page.getByTestId('lesson-voice-submit').click();
}

test('↺ takes back a "Got it" tapped by mistake: back on the answer side, regraded, owed, missed in the outcome', async ({ page, request }) => {
  test.setTimeout(150_000);
  const user = await seedUser(request);
  const created = await api<{ lesson: { id: string } } | { id: string }>(request, '/api/custom-lessons', { method: 'POST', token: user.token, data: { spec } });
  const id = 'lesson' in created ? created.lesson.id : created.id;

  await page.goto(`/lessons?session_token=${user.token}`);
  await expect(page.getByTestId(`lesson-play-${id}`)).toBeVisible({ timeout: 30_000 });
  await page.goto(`/lessons/${id}/play?from=home`);
  await expect(page.getByText('I put a little sugar in the coffee.')).toBeVisible({ timeout: 30_000 });
  // Nothing answered yet: ↺ is there but greyed.
  await expect(page.getByTestId('lesson-undo')).toBeDisabled();

  // A wrong answer… and "✓ Got it" by mistake.
  await typeAnswer(page, '我在咖啡里放了有点儿糖');
  await expect(page.getByTestId('lesson-your-answer')).toContainText('我在咖啡里放了有点儿糖');
  await page.getByTestId('lesson-got-it').click();
  await expect(page.getByText('Which one means "a bit expensive"?')).toBeVisible();

  // ↺: the translation is back on its answer side with what he typed.
  await page.getByTestId('lesson-undo').click();
  await expect(page.getByText('I put a little sugar in the coffee.')).toBeVisible();
  await expect(page.getByTestId('lesson-your-answer')).toContainText('我在咖啡里放了有点儿糖');
  await expect(page.getByTestId('lesson-undo')).toBeDisabled();
  await page.getByTestId('lesson-missed-it').click();

  // The choice: answered, ↺, and it comes back fresh (no option picked).
  await page.locator('.contrast-option', { hasText: '一点儿贵' }).click();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('lesson-retry-line')).toBeVisible();
  await page.getByTestId('lesson-undo').click();
  await expect(page.getByText('Which one means "a bit expensive"?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0);
  await page.locator('.contrast-option', { hasText: '有点儿贵' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  // The retry round: only the translation he now says he missed.
  await expect(page.getByTestId('lesson-retry-line')).toContainText("Let's put this one right · last one");
  await expect(page.getByText('I put a little sugar in the coffee.')).toBeVisible();
  await typeAnswer(page, '我在咖啡里放了一点儿糖');
  await page.getByTestId('lesson-got-it').click();
  await expect(page.getByTestId('lesson-end-line')).toContainText('Back in a week as a revision');
  // The completion is recorded at the end: no ↺ on the finish screen.
  await expect(page.getByTestId('lesson-undo')).toHaveCount(0);
  await page.getByTestId('lesson-done').click();

  await expect.poll(() => outcomes(request, user, id), { timeout: 30_000 }).toEqual([{ keys: ['s0e0', 's0e1'], missed: ['s0e0'] }]);
});
