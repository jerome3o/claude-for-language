import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Web auto-audio (docs/AUDIO.md): a card without its clip asks
 * POST /api/notes/:id/ensure-audio; while MiniMax is busy (`queued`) the card
 * says "Audio coming…" instead of silently using the device voice, checks back,
 * and the pill goes once the clip has arrived.
 *
 * The local worker has no MiniMax key, so the ensure-audio answers are stubbed
 * at the network layer: first `queued`, then the clip.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SHOTS = process.env.SHOT_DIR;

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {},
): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

test('a card without its clip shows "Audio coming…" until the clip arrives', async ({ page, request }) => {
  test.setTimeout(90_000);
  const email = `audio-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Audio' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: '天气' } });
  const note = await api<{ id: string }>(request, `/api/decks/${deck.id}/notes`, {
    method: 'POST', token, data: { hanzi: '刮风', pinyin: 'guā fēng', english: 'to be windy', sentence_clue: '今天外面刮风了。', sentence_clue_pinyin: 'Jīntiān wàimiàn guā fēng le.', sentence_clue_translation: "It's windy outside today." },
  });

  const asked: string[] = [];
  await page.route(`**/api/notes/${note.id}/ensure-audio`, async (route) => {
    asked.push(route.request().postData() ?? '');
    const base = { id: note.id, deck_id: deck.id, hanzi: '刮风', pinyin: 'guā fēng', english: 'to be windy', sentence_clue: '今天外面刮风了。', updated_at: '2026-10-03 12:00:00' };
    const body = asked.length === 1
      ? { note: { ...base, audio_url: null, sentence_clue_audio_url: null }, word: 'queued', sentence: 'queued' }
      : { note: { ...base, audio_url: `generated/${note.id}_e2e.mp3`, audio_provider: 'minimax', sentence_clue_audio_url: `generated/${note.id}-sentence_e2e.mp3` }, word: 'generated', sentence: 'generated' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto(`/decks?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await expect(page.getByText('天气')).toBeVisible({ timeout: 30000 });
  await page.goto(`/study?deck=${deck.id}&autostart=true`);

  const reveal = page.getByRole('button', { name: /Skip recording|Show Answer|Check Answer|Reveal/i }).first();
  await reveal.waitFor({ timeout: 30000 });
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  if (SHOTS && (await page.getByText(/Audio coming/).isVisible().catch(() => false))) {
    await page.screenshot({ path: `${SHOTS}/01-front-audio-coming.png` });
  }
  const typed = page.locator('input[type="text"], textarea').first();
  if (await typed.isVisible().catch(() => false)) await typed.fill('刮风');
  await reveal.click();
  await page.getByTestId('study-action-row').waitFor({ timeout: 15000 });

  // queued → the quiet pill next to Play
  await expect(page.getByText('Audio coming…')).toBeVisible({ timeout: 15000 });
  expect(asked.length).toBe(1);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-back-audio-coming.png` });

  // the card checks back (~20 s) and the pill goes when the clip is there
  await expect(page.getByText('Audio coming…')).toBeHidden({ timeout: 40000 });
  expect(asked.length).toBeGreaterThanOrEqual(2);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-back-clip-arrived.png` });
});
