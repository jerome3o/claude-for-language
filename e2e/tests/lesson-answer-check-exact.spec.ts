import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Claude's check of a "Say it in Chinese" answer (docs/STUDY_SESSION.md "Claude checks your
 * answer"): an answer that IS the model answer ("✓ Exact match") is checked on the device — the
 * card says "Exactly right — nice!" at once and POST /api/lessons/answer-check is never called.
 * A different answer still goes to Claude (the fake model in E2E_TEST_MODE).
 */
test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined } });

const API = process.env.E2E_API_URL || 'http://localhost:8787';

async function seedUser(request: APIRequestContext): Promise<string> {
  const email = `exact-check-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const res = await request.post(`${API}/api/test/auth`, { data: { email, name: 'Exact', role: 'tutor' } });
  if (!res.ok()) throw new Error(`auth ${res.status()}`);
  return ((await res.json()) as { session_token: string }).session_token;
}

test('the model answer itself never reaches Claude; another wording does', async ({ page, request }) => {
  const token = await seedUser(request);
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/lessons/answer-check')) calls.push(r.postData() ?? '');
  });
  await page.goto(`/library/catalogue?session_token=${token}`);
  await expect(page.getByRole('heading', { name: /Exercise catalogue/ })).toBeVisible({ timeout: 30000 });
  await page.locator('#type-translate').getByRole('link', { name: /Try it/ }).click();
  await expect(page.getByText('Please put the book on the table.')).toBeVisible({ timeout: 15000 });

  const answer = async (text: string) => {
    const type = page.getByTestId('lesson-voice-type');
    if (await type.isVisible().catch(() => false)) await type.click();
    await page.getByTestId('lesson-voice-text').fill(text);
    await page.getByTestId('lesson-voice-submit').click();
  };

  await answer('请把书放在桌子上');
  await expect(page.getByText('✓ Exact match')).toBeVisible();
  const card = page.getByTestId('answer-check');
  await expect(card).toHaveAttribute('data-verdict', 'correct');
  await expect(card).toContainText('Exactly right — nice!');
  await expect(page.getByTestId('answer-check-checking')).toHaveCount(0);
  await expect(page.getByTestId('lesson-got-it')).toHaveClass(/suggested/);
  expect(calls).toHaveLength(0);

  // 🔁 Try again with other wording: Claude is asked.
  await page.getByTestId('answer-check-retry').click();
  await answer('请你把书放桌子上');
  await expect(page.getByTestId('answer-check')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('answer-check')).not.toContainText('Exactly right');
  expect(calls).toHaveLength(1);
});
