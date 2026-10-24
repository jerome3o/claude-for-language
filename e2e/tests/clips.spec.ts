import { test, expect, APIRequestContext } from '@playwright/test';
import { SAMPLE_CLIP, SAMPLE_STORY_CLIP } from '../../shared/clips/sample';

/**
 * 🎬 Clips (experimental; docs/CLIPS.md): two clips imported through the API → More → Practice →
 * 🎬 Clips → the first plays (hook, scenes), swipe to the next, a quiz answered, double-tap → ❤️
 * burst + like + the Learn more sheet → ✨ Mini lesson (the E2E stand-in writes it in the
 * learner's own account) opens in the lesson player. The like reached the server.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

type Clip = { id: string; title: string; state: { liked: boolean; viewed: boolean } };

test('clips: play, swipe, quiz, double-tap → like + Learn more → a mini lesson', async ({ page, request }) => {
  test.setTimeout(120_000);
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email: `clips-${stamp}@test.e2e`, name: 'Jerome' } });

  // A broken spec is refused with its problems.
  const bad = await request.fetch(`${API}/api/clips`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` }, data: JSON.stringify({ spec: { v: 1, title: 'x' } }) });
  expect(bad.status()).toBe(400);
  expect(((await bad.json()) as { problems: string[] }).problems).toContain('hook is required (big on screen in the first scene)');

  const story = (await api<{ clip: Clip }>(request, '/api/clips', { method: 'POST', token, data: { spec: SAMPLE_STORY_CLIP } })).clip;
  const neon = (await api<{ clip: Clip }>(request, '/api/clips', { method: 'POST', token, data: { spec: SAMPLE_CLIP } })).clip;
  const feed = (await api<{ clips: Clip[] }>(request, '/api/clips', { token })).clips;
  expect(feed).toHaveLength(2);

  // Sound off: no TTS in E2E, and the clock never waits on it.
  await page.addInitScript(() => localStorage.setItem('clips-captions-v1', JSON.stringify({ pinyin: true, english: true, muted: true })));
  await page.goto(`/?session_token=${token}`);
  await page.waitForLoadState('networkidle');
  await page.goto('/more');
  await page.getByRole('link', { name: /Clips \(beta\)/ }).click();
  await expect(page).toHaveURL(/\/clips$/);

  const first = page.locator(`[data-clip-id="${feed[0].id}"]`);
  await expect(first.getByTestId('clip-hook')).toBeVisible();
  await expect(first).toHaveAttribute('data-scene', '0');
  // It plays on its own: the title gives way to the next scene.
  await expect(first).toHaveAttribute('data-scene', '1', { timeout: 10_000 });

  // Swipe up → the second clip plays.
  await page.getByTestId('clips-feed').evaluate((el) => el.scrollTo({ top: el.clientHeight }));
  const second = page.locator(`[data-clip-id="${feed[1].id}"]`);
  await expect(second.getByTestId('clip-hook')).toBeVisible();

  // The quiz waits for a tap and reacts (a /clips/:id?scene= link starts at the quiz).
  await page.goto(`/clips/${neon.id}?scene=4`);
  const quizClip = page.locator(`[data-clip-id="${neon.id}"]`);
  await expect(quizClip).toHaveAttribute('data-scene', '4');
  await quizClip.getByTestId('clip-quiz-option').filter({ hasText: '刚才' }).click();
  await expect(quizClip.getByTestId('clip-quiz-verdict')).toHaveText('✓ Right!');

  // Double-tap → ❤️ burst, liked, then the Learn more sheet.
  const box = (await quizClip.boundingBox())!;
  const x = box.x + 120;
  const y = box.y + 140;
  await page.mouse.click(x, y);
  await page.mouse.click(x, y);
  await expect(page.getByTestId('clip-heart').first()).toBeVisible();
  await expect(quizClip.getByTestId('clip-like')).toHaveAttribute('aria-pressed', 'true');
  const sheet = page.getByTestId('clip-learn-more-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Keep going with 刚 vs 刚才');
  await expect(sheet.getByTestId('clip-offer-reader')).toBeVisible();

  // ⚡ / + Add: the clip's words, each with + Add (none are in a deck yet).
  await sheet.getByTestId('clip-offer-add_card').click();
  await expect(sheet.getByTestId('clip-words-panel')).toContainText('刚才');

  // ✨ Mini lesson → written in this account → the lesson player.
  await sheet.getByTestId('clip-offer-lesson').click();
  await expect(page).toHaveURL(/\/lessons\/[^/]+\/play/, { timeout: 30_000 });

  // The like reached the server (events upload from the device).
  await expect
    .poll(async () => (await api<{ clips: Clip[] }>(request, '/api/clips', { token })).clips.find((c) => c.id === neon.id)?.state.liked, { timeout: 15_000 })
    .toBe(true);
  expect(story.title).toBe(SAMPLE_STORY_CLIP.title);
});
