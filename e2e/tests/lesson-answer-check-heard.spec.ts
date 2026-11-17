import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * What the ear can't tell (docs/STUDY_SESSION.md "What the ear can't tell", shared/lesson/heardCheck.ts). Jerome heard
 * 她责怪我 (tā zéguài wǒ, "She blamed me.") in Hard mode's "👂 What does it mean?", answered "He blames me." and got
 * "≈ Nearly · Wrong subject" — 他 / 她 / 它 all sound tā, and 她责怪我 marks no tense. The E2E stand-in answers the way
 * the model did (services/answer-check-fake.ts); `forgiveUnheard` makes it right. What the ear CAN tell still counts,
 * and a translate he READ stays strict.
 */
test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined } });

const API = process.env.E2E_API_URL || 'http://localhost:8787';

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function signIn(request: APIRequestContext): Promise<string> {
  const email = `answer-heard-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  return session_token;
}

type Check = { check: { verdict: string; headline: string; tips: unknown[] } };

test('the meaning check (Sentences by ear): "He blames me." for 她责怪我 is right; roles swapped / a negation are not', async ({ request }) => {
  const token = await signIn(request);
  const meaning = (answer: string) => api<Check>(request, '/api/lessons/answer-check', {
    method: 'POST',
    token,
    data: { exercise_type: 'listen_translate', prompt_en: '她责怪我。', model_answer: 'She blamed me.', model_pinyin: 'Tā zéguài wǒ.', answer, input: 'spoken' },
  });
  const jerome = await meaning('He blames me.');
  expect(jerome.check.verdict).toBe('correct');
  expect(jerome.check.tips).toEqual([]);
  expect(jerome.check.headline).not.toContain('Wrong subject');
  expect((await meaning('She blames me')).check.verdict).toBe('correct');
  expect((await meaning('I blamed her')).check.verdict).toBe('wrong');
  expect((await meaning("She didn't blame me")).check.verdict).toBe('almost');
});

const lesson = (type: 'listen_translate' | 'translate') => ({
  title: '责怪 · Blame',
  icon: '🎧',
  sections: [{
    exercises: [type === 'listen_translate'
      ? { type, audio: { hanzi: '她责怪我。', pinyin: 'Tā zéguài wǒ.', english: 'She blamed me.' } }
      : { type, english: 'She blamed me.', reference_hanzi: '她责怪我。', reference_pinyin: 'Tā zéguài wǒ.' }],
  }],
});

async function answerLesson(page: import('@playwright/test').Page, request: APIRequestContext, type: 'listen_translate' | 'translate') {
  const token = await signIn(request);
  const created = await api<{ lesson: { id: string } } | { id: string }>(request, '/api/custom-lessons', { method: 'POST', token, data: { spec: lesson(type) } });
  const id = 'lesson' in created ? created.lesson.id : created.id;
  await page.goto(`/lessons/${id}/play?from=lessons_page&session_token=${token}`);
  const typeButton = page.getByTestId('lesson-voice-type');
  await expect(typeButton.or(page.getByTestId('lesson-voice-text'))).toBeVisible({ timeout: 30_000 });
  if (await typeButton.isVisible().catch(() => false)) await typeButton.click();
  await page.getByTestId('lesson-voice-text').fill('他责怪我。');
  await page.getByTestId('lesson-voice-submit').click();
  return page.getByTestId('answer-check');
}

test('Listen and translate answered in Chinese: 他 for the 她 he heard is right', async ({ page, request }) => {
  const card = await answerLesson(page, request, 'listen_translate');
  await expect(card).toHaveAttribute('data-verdict', 'correct', { timeout: 15_000 });
  await expect(card).toContainText('all sound tā');
  await expect(card).not.toContainText('Use 她, not 他');
  await expect(page.getByRole('button', { name: '✓ Got it' })).toHaveClass(/suggested/);
});

test('a translate he READ stays strict: 他 for "She" is still ≈ Almost', async ({ page, request }) => {
  const card = await answerLesson(page, request, 'translate');
  await expect(card).toHaveAttribute('data-verdict', 'almost', { timeout: 15_000 });
  await expect(card).toContainText('Use 她, not 他');
});
