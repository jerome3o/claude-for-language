import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Jerome (Nov 2026): "This croissant was just over three yuan." He said 这个牛角包 3块多元 (the model answer is
 * 这个牛角包三块多钱). The check said "~ Almost" (right) but "Use 钱 or 块 alone, not both together" over a corrected line
 * with both, offered his own 块多元 as a fix, dropped the 3 from the fix's pinyin and painted 3 red against 三.
 * docs/STUDY_SESSION.md "Claude checks your answer" → "…and stays coherent when it says almost": the fake model returns
 * that very check; the coherence rules leave a neutral headline and no tip, the fix shows 三, and 3 is never marked.
 * COHERENCE_SHOTS=<dir> also saves a phone-size screenshot there (PR screenshots).
 */
test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined }, viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SHOTS = process.env.COHERENCE_SHOTS;

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
  title: '多 · A bit more than',
  icon: '🥐',
  sections: [{
    exercises: [
      { type: 'translate', english: 'This croissant was just over three yuan.', reference_hanzi: '这个牛角包三块多钱。', reference_pinyin: 'Zhège niújiǎobāo sān kuài duō qián.' },
    ],
  }],
};

test('the croissant: a coherent "Almost" — neutral headline, no tip offering 块多元, 三 in the fix, 3 never red', async ({ page, request }) => {
  const email = `answer-coherence-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const created = await api<{ lesson: { id: string } } | { id: string }>(request, '/api/custom-lessons', { method: 'POST', token, data: { spec } });
  const id = 'lesson' in created ? created.lesson.id : created.id;

  await page.goto(`/lessons/${id}/play?from=lessons_page&session_token=${token}`);
  await expect(page.getByText('This croissant was just over three yuan.')).toBeVisible({ timeout: 30_000 });
  const type = page.getByTestId('lesson-voice-type');
  if (await type.isVisible().catch(() => false)) await type.click();
  await page.getByTestId('lesson-voice-text').fill('这个牛角包 3块多元。');
  await page.getByTestId('lesson-voice-submit').click();

  // "You said": the 3 is 三 — only 元 is marked (wrong, the answer has 钱), under one short line.
  const said = page.getByTestId('lesson-marked-answer');
  await expect(said).toBeVisible();
  await expect(said.locator('[data-kind]')).toHaveText(['元']);
  await expect(page.getByTestId('lesson-answer-diff-line')).toHaveText('元 instead of 钱');

  const card = page.getByTestId('answer-check');
  await expect(card).toHaveAttribute('data-verdict', 'almost', { timeout: 15_000 });
  await expect(card).toContainText('Nearly — compare with the corrected version.');
  await expect(card).not.toContainText('not both');
  await expect(card).not.toContainText('(块多元)');
  // Slim: the chip + ONE line — no red-pen fix, tips or alternative (the diff above already says 元 → 钱).
  await expect(card.locator('.answer-check-fix-line')).toHaveCount(0);
  await expect(card.locator('.answer-check-tips')).toHaveCount(0);
  // The fix IS the model answer once 3 = 三: no "Say the corrected version" to practise.
  await expect(page.getByTestId('lesson-say-fix')).toHaveCount(0);
  await page.mouse.move(0, 0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-croissant.png`, fullPage: true });
});
