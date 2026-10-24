import { test, expect, APIRequestContext } from '@playwright/test';
import { skipFirstCardExplainer } from './fixtures/explainer';

/**
 * 🎤 on the study card's example sentence rows + "Get two sentences right before Good / Easy"
 * (docs/STUDY_SESSION.md "Practise a sentence aloud"; shared/study/sentencePractise.ts). With the
 * setting on (per device), a reading card's answer side says what unlocks Good, a tap on a locked
 * Good / Easy rates nothing and says why, Again still rates. A blank row has no 🎤; an open row has
 * a read 🎤 left of ▶; EN with the Chinese hidden makes it "Say it in Chinese". (Takes themselves
 * need a microphone: the component test covers them.)
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PUT'; token?: string; data?: unknown } = {},
): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

test.beforeEach(async ({ context }) => {
  await skipFirstCardExplainer(context);
  await context.addInitScript(() => {
    try { localStorage.setItem('sentence-gate-v1', '1'); } catch { /* ignore */ }
  });
});
test.use({ viewport: { width: 412, height: 915 } });

test('sentence gate: Good / Easy wait for the sentences, Again rates; rows get a 🎤 once open', async ({ page, request }) => {
  test.setTimeout(120_000);
  const email = `sentence-gate-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Gate learner' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'Bank words' } });
  await api(request, `/api/decks/${deck.id}/notes?check=none`, {
    method: 'POST',
    token,
    data: {
      hanzi: '银行', pinyin: 'yínháng', english: 'bank',
      sentence_clue: '我去银行取钱。', sentence_clue_pinyin: 'Wǒ qù yínháng qǔ qián.', sentence_clue_translation: 'I go to the bank to get money.',
    },
  });

  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('Bank words').first()).toBeVisible({ timeout: 30000 });
  const reveal = page.getByRole('button', { name: /Skip recording|Show Answer|Check Answer|Reveal/i }).first();
  await expect(async () => {
    await page.goto(`/study?deck=${deck.id}&autostart=true`);
    await expect(reveal).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 60000 });
  await reveal.click();

  const back = page.getByTestId('study-card-back');
  await expect(back).toBeVisible();
  const gate = page.getByTestId('sentence-gate');
  await expect(gate).toBeVisible({ timeout: 15000 });
  await expect(gate).toHaveAttribute('data-locked', 'true');
  await expect(gate).toContainText(/Get (1 sentence|2 sentences) right to unlock Good · 0\//);
  await expect(page.getByTestId('rating-good')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('rating-easy')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('rating-again')).not.toHaveAttribute('aria-disabled', 'true');

  // A tap on a locked Good rates nothing and says why.
  await page.getByTestId('rating-good').click({ force: true }); // aria-disabled: Playwright won't tap it otherwise
  await expect(gate).toContainText('right with 🎤 to unlock Good and Easy');
  await expect(back).toBeVisible();

  // The card's sentence: no 🎤 while blank, a read 🎤 left of ▶ once the Chinese is up…
  const row = page.locator('.sentence-set-row').first();
  await expect(row.getByTestId('sentence-practise-mic')).toHaveCount(0);
  await row.locator('.sentence-set-hidden').click();
  await expect(row.locator('.sentence-set-hanzi')).toHaveText('我去银行取钱。');
  const mic = row.getByTestId('sentence-practise-mic');
  await expect(mic).toHaveAttribute('data-mode', 'read');
  const micBox = (await mic.boundingBox())!;
  const playBox = (await row.locator('.sentence-set-play').boundingBox())!;
  expect(micBox.x + micBox.width).toBeLessThanOrEqual(playBox.x + 1);
  // …and English-first with the Chinese hidden: say it in Chinese.
  await row.locator('.sentence-set-en').click();
  await expect(row.locator('.sentence-set-hanzi')).toHaveCount(0);
  await expect(row.getByTestId('sentence-practise-mic')).toHaveAttribute('data-mode', 'translate');

  // Again is always there.
  await page.getByTestId('rating-again').click();
  await expect(page.getByTestId('study-card-back')).toHaveCount(0, { timeout: 15000 });
  await expect(page.getByTestId('sentence-gate')).toHaveCount(0);
});
