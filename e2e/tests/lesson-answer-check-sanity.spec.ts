import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Jerome (Nov 2026): "Say it in Chinese" — "I can't sleep because of this problem." He said 因为这个问题，我睡不着觉 (the
 * model answer is 我因为这个问题睡不着觉) and got "✓ Also right — Correct meaning, but 因为 clause should come before the
 * subject", a tip comparing two identical strings, and 我 painted red on both rows. docs/STUDY_SESSION.md "Claude checks
 * your answer" → "A check never contradicts itself":
 * - the device never marks a reordering of the same characters (a neutral note instead);
 * - the fake model returns that very check, and the sanity rules leave a plain positive card with no tips.
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

const spec = {
  title: '因为…所以… · Giving reasons',
  icon: '💤',
  sections: [{
    exercises: [
      { type: 'translate', english: "I can't sleep because of this problem.", reference_hanzi: '我因为这个问题睡不着觉。', reference_pinyin: 'Wǒ yīnwèi zhège wèntí shuì bu zháo jiào.' },
    ],
  }],
};

test('a reordered answer: no red marks, and Claude\'s contradictory check is cleaned to a plain "Also right"', async ({ page, request }) => {
  const email = `answer-sanity-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const created = await api<{ lesson: { id: string } } | { id: string }>(request, '/api/custom-lessons', { method: 'POST', token, data: { spec } });
  const id = 'lesson' in created ? created.lesson.id : created.id;

  await page.goto(`/lessons/${id}/play?from=lessons_page&session_token=${token}`);
  await expect(page.getByText("I can't sleep because of this problem.")).toBeVisible({ timeout: 30_000 });
  const type = page.getByTestId('lesson-voice-type');
  if (await type.isVisible().catch(() => false)) await type.click();
  await page.getByTestId('lesson-voice-text').fill('因为这个问题，我睡不着觉。');
  await page.getByTestId('lesson-voice-submit').click();

  // The device: same characters in another order → a neutral note, nothing painted on either row.
  await expect(page.getByTestId('lesson-answer-note')).toHaveText('Same characters, different word order');
  await expect(page.getByTestId('lesson-marked-answer')).toHaveCount(0);
  await expect(page.getByTestId('lesson-marked-model')).toHaveCount(0);

  // Claude (the fake returns the real contradictory check): no "but", no tip comparing a text with itself.
  const card = page.getByTestId('answer-check');
  await expect(card).toHaveAttribute('data-verdict', 'acceptable', { timeout: 15_000 });
  await expect(card).toContainText('Different wording, same meaning — that works.');
  await expect(card).not.toContainText('should come before');
  await expect(card).not.toContainText('reads more naturally');
  await expect(page.getByTestId('lesson-got-it')).toHaveClass(/suggested/);
});
