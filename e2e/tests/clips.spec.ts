import { test, expect, APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLE_CLIP, SAMPLE_INTERACTIVE_CLIP, SAMPLE_STORY_CLIP } from '../../shared/clips/sample';
import { clipOrderShuffle } from '../../shared/clips/playback';

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
  await page.addInitScript(() => localStorage.setItem('clips-captions-v1', JSON.stringify({ pinyin: true, english: true, muted: true, music: false })));
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
  // (on the title / tags at the bottom: the answered quiz fills the middle with buttons)
  const box = (await quizClip.boundingBox())!;
  const x = box.x + 60;
  const y = box.y + box.height - 50;
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

/** A real finger flick (touch events through CDP — what the browser turns into a scroll + fling). */
async function flick(page: Page, x: number, y: number, dir: 1 | -1) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dir * i * 40 }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test.describe('clips on a phone', () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

  test('flick up / down pages the feed; karaoke follows the voice; an order beat waits and checks', async ({ page, request }) => {
    test.setTimeout(120_000);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email: `clips-touch-${stamp}@test.e2e`, name: 'Jerome' } });
    const inter = (await api<{ clip: Clip }>(request, '/api/clips', { method: 'POST', token, data: { spec: SAMPLE_INTERACTIVE_CLIP } })).clip;
    await api(request, '/api/clips', { method: 'POST', token, data: { spec: SAMPLE_STORY_CLIP } });
    const neon = (await api<{ clip: Clip }>(request, '/api/clips', { method: 'POST', token, data: { spec: SAMPLE_CLIP } })).clip;
    const feed = (await api<{ clips: Clip[] }>(request, '/api/clips', { token })).clips;

    // The voice lines: a 2.4 s clip for every line (no real TTS in E2E), sound on, no music.
    const tone = readFileSync(join(__dirname, 'fixtures', 'tone-2400ms.mp3')).toString('base64');
    await page.route('**/api/practice/tts', (route) => route.fulfill({ json: { audio_base64: tone, content_type: 'audio/mpeg' } }));
    await page.addInitScript(() => localStorage.setItem('clips-captions-v1', JSON.stringify({ pinyin: true, english: true, muted: false, music: false })));
    await page.goto(`/?session_token=${token}`);
    await page.waitForLoadState('networkidle');
    await page.goto(`/clips/${neon.id}`);
    const at = (i: number) => page.locator(`[data-clip-id="${feed[i].id}"]`);
    const start = feed.findIndex((c) => c.id === neon.id);
    await expect(at(start)).toBeVisible();
    await page.locator('.clips-badge').tap(); // a user gesture, so audio may play

    // Karaoke: the caption's active word moves forward while the line plays.
    const karaoke = page.locator(`[data-clip-id="${neon.id}"] [data-testid="clip-caption"] [data-testid="clip-karaoke"]`);
    await expect.poll(async () => Number(await karaoke.getAttribute('data-active')), { timeout: 15_000 }).toBeGreaterThanOrEqual(0);
    const first = Number(await karaoke.getAttribute('data-active'));
    await expect.poll(async () => Number(await karaoke.getAttribute('data-active')), { timeout: 10_000 }).toBeGreaterThan(first);
    await expect(karaoke.locator('[data-state="active"]')).toHaveCount(1);

    // A normal flick up → the next clip; down → back.
    const index = () => page.getByTestId('clips-feed').evaluate((el) => Math.round(el.scrollTop / el.clientHeight));
    expect(await index()).toBe(start);
    const up = start < feed.length - 1;
    await flick(page, 200, up ? 640 : 300, up ? -1 : 1);
    await expect.poll(index, { timeout: 5000 }).toBe(start + (up ? 1 : -1));
    await flick(page, 200, up ? 300 : 640, up ? 1 : -1);
    await expect.poll(index, { timeout: 5000 }).toBe(start);
    // …and the ⌄ Next button on the rail.
    if (start < feed.length - 1) {
      await at(start).getByTestId('clip-next').tap();
      await expect.poll(index, { timeout: 5000 }).toBe(start + 1);
    }

    // An order beat: the clip waits ("👆 Tap the words in order"), the tiles in the right order → ✓.
    await page.goto(`/clips/${inter.id}?scene=4`);
    const clip = page.locator(`[data-clip-id="${inter.id}"]`);
    await expect(clip).toHaveAttribute('data-scene', '4');
    await expect(clip.getByTestId('clip-order-hint')).toHaveText('👆 Tap the words in order');
    const offered = clipOrderShuffle(['我', '下班', '顺便', '去', '银行'], `${inter.id}:4`);
    const tiles = clip.getByTestId('clip-order-tile');
    await expect(tiles).toHaveCount(5);
    for (let t = 0; t < 5; t++) {
      const tile = tiles.nth(offered.indexOf(t));
      await expect(tile).toBeEnabled();
      await tile.click();
    }
    await expect(clip.getByTestId('clip-quiz-verdict')).toHaveText('✓ Right!');
    await clip.getByTestId('clip-continue').tap();
    await expect(clip).toHaveAttribute('data-scene', '5');
    await clip.getByTestId('clip-reveal-card').tap();
    await expect(clip.getByTestId('clip-reveal-card')).toHaveClass(/flipped/);
  });
});
