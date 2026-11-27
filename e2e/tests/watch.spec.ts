import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * 📺 Watch (docs/WATCH.md): More → Watch → paste a link → the player (the dev-build stand-in for
 * YouTube's embed — `window.__watchStandIn`, a drawn colour clip, never a real video) → the video
 * is added with the length the player reports → the E2E stand-in transcript (worker
 * services/watch/transcribe.ts `fakeWatchTranscriber`) → ⏭ / 🔁 by line, Pause after each line,
 * a word → the language explorer, listen first, speed → back to the list with its status.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
/** A fresh id every run, so the add path (a video nobody has added yet) is the one tested. */
const VIDEO_ID = `E2e${Math.random().toString(36).slice(2, 10).padEnd(8, 'x')}`;

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** Hermetic: the stand-in player, and YouTube's thumbnails answered locally (a 1×1 PNG). */
async function standIn(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __watchStandIn: number }).__watchStandIn = 60;
  });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqPtfDwAEPgHfJPpN2QAAAABJRU5ErkJggg==', 'base64');
  await page.route('https://i.ytimg.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: png }));
}

test('watch: paste a link → transcript → line by line, pause after each line, a word → explorer, listen first', async ({ page, request }) => {
  test.setTimeout(120_000);
  const email = `watch-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  await standIn(page);
  await page.setViewportSize({ width: 412, height: 915 });

  await page.goto(`/?session_token=${token}`);
  await page.waitForLoadState('networkidle');
  await page.goto('/more');
  await page.getByRole('link', { name: /Watch/ }).first().click();
  await expect(page).toHaveURL(/\/watch$/);
  await expect(page.getByText('No videos yet')).toBeVisible();
  await expect(page.getByRole('link', { name: /小欢喜/ })).toHaveAttribute('href', /youtube\.com\/results\?search_query=/);

  // Not a video link → a readable problem; a youtu.be link → the player.
  await page.getByTestId('watch-link').fill('https://www.youtube.com/channel/UC123');
  await page.getByRole('button', { name: 'Watch', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText("doesn't look like a YouTube video link");
  await page.getByTestId('watch-link').fill(`看这个 https://youtu.be/${VIDEO_ID}?si=abc`);
  await page.getByRole('button', { name: 'Watch', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/watch/${VIDEO_ID}\\?source=paste`));
  await expect(page.getByTestId('watch-stand-in')).toBeVisible();

  // The player reports the length → the video is added → the stand-in transcript arrives.
  const lines = page.getByTestId('watch-lines').locator('li.watch-line');
  await expect(lines.first()).toBeVisible({ timeout: 30_000 });
  await expect(lines).toHaveCount(14, { timeout: 30_000 });
  await expect(lines.first()).toContainText('你怎么才回来？饭都凉了。');
  await expect(page.getByTestId('watch-card')).toContainText('the first line is at 0:02');

  // Pause after each line: ⏭ → the first line plays to its end and stops there, still on screen.
  await page.getByTestId('watch-pause-mode').click();
  await expect(page.getByTestId('watch-pause-mode')).toHaveAttribute('aria-pressed', 'true');
  const play = page.getByTestId('watch-play');
  await page.getByRole('button', { name: 'Next line' }).click();
  const card = page.getByTestId('watch-card');
  await expect(card).toContainText('你怎么才回来？饭都凉了。');
  await expect(card).toContainText('Segment 1 of the episode.');
  await expect(play).toHaveAttribute('aria-label', 'Pause');
  await expect(play).toHaveAttribute('aria-label', 'Play', { timeout: 10_000 });
  await expect(card).toContainText('你怎么才回来？饭都凉了。');

  // ⏭ → the second line, which stops at its end too; 🔁 plays it again.
  await page.getByRole('button', { name: 'Next line' }).click();
  await expect(card).toContainText('学校今天开家长会');
  await expect(play).toHaveAttribute('aria-label', 'Play', { timeout: 10_000 });
  await page.getByRole('button', { name: 'Replay this line' }).click();
  await expect(play).toHaveAttribute('aria-label', 'Pause');
  await expect(card).toContainText('学校今天开家长会');
  await expect(play).toHaveAttribute('aria-label', 'Play', { timeout: 10_000 });
  await expect(card).toContainText('学校今天开家长会');

  // A word on the card → the language explorer.
  await card.getByTestId('chat-words').getByRole('button').filter({ hasText: '学校' }).first().click();
  await expect(page.getByTestId('explorer')).toBeVisible();
  await expect(page.getByTestId('explorer')).toContainText('学校');
  await page.getByTestId('explorer-close').click();

  // Speed: 1× → 0.75×.
  await page.getByTestId('watch-speed').click();
  await expect(page.getByTestId('watch-speed')).toHaveText('0.75×');

  // Listen first: the card is covered; a tap shows the Chinese, then the pinyin.
  await page.getByTestId('watch-listen').click();
  await expect(card).toContainText('Listen… tap to see the Chinese');
  await expect(page.getByTestId('watch-lines')).toContainText('· · ·');
  await card.click({ position: { x: 8, y: 8 } });
  await expect(card).toContainText('学校今天开家长会');
  await card.click({ position: { x: 8, y: 8 } });
  await expect(card).toContainText('xué xiào');

  // Back to the list: the video with its status.
  await page.getByRole('button', { name: 'Back to my videos' }).click();
  await expect(page).toHaveURL(/\/watch$/);
  const row = page.getByTestId('watch-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Transcript ready · 14 lines');

  // The server has my video, with where I was.
  const list = await api<{ videos: Array<{ id: string; status: string; duration_ms: number }> }>(request, '/api/watch', { token });
  expect(list.videos).toHaveLength(1);
  expect(list.videos[0]).toMatchObject({ id: VIDEO_ID, status: 'ready', duration_ms: 60_000 });
});

test('watch: the share target opens the player; a share without a video link says so', async ({ page, request }) => {
  const email = `watch-share-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  await standIn(page);
  await page.goto(`/?session_token=${token}`);
  await page.waitForLoadState('networkidle');
  await page.goto(`/watch/share?text=${encodeURIComponent(`小欢喜 第1集 https://www.youtube.com/watch?v=${VIDEO_ID}`)}`);
  await expect(page).toHaveURL(new RegExp(`/watch/${VIDEO_ID}\\?source=share`));
  await expect(page.getByTestId('watch-stand-in')).toBeVisible();
  await page.goto('/watch/share?text=hello');
  await expect(page.getByRole('alert')).toContainText("wasn't a YouTube video link");
});
