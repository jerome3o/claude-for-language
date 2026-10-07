import { request as playwrightRequest } from '@playwright/test';
import { test, expect } from './fixtures/auth';

/**
 * Audio lessons (/audio-lessons, docs/AUDIO_LESSONS.md). E2E_TEST_MODE runs the
 * whole pipeline with a fake model (the sample plan) and fake voices (silent
 * lesson-format MP3 clips): the lesson is written, "recorded", rendered into
 * one MP3, saved on the device and played in the player with its chapters,
 * transcript and sleep timer.
 */

test('make a sleep lesson, then play it from the device', async ({ authenticatedPage: page }) => {
  test.setTimeout(120_000);
  await page.gotoAuthenticated('/audio-lessons');
  await expect(page.getByRole('heading', { name: '🎧 Audio lessons' })).toBeVisible({ timeout: 30000 });

  await page.getByRole('radio', { name: /Sleep/ }).click();
  await page.getByLabel(/Paste some Chinese/).fill('我家旁边有一个邮局，邮局在银行旁边。我常常去邮局给妈妈寄信，有时候也寄一本书。');
  await page.getByRole('button', { name: '🎧 Make the lesson' }).click();

  // Built in the background (seconds with the fakes); the list polls.
  const row = page.getByRole('button', { name: 'Play 银行和邮局' });
  await expect(row).toBeVisible({ timeout: 60000 });
  await expect(page.getByText(/2 words/)).toBeVisible();
  await row.click();

  await expect(page).toHaveURL(/\/audio-lessons\/[^/]+$/);
  await expect(page.getByText('🌙 Sleep lesson')).toBeVisible();
  await expect(page.getByText('✓ Saved on this phone · plays offline')).toBeVisible({ timeout: 30000 });

  // The file is real MP3 with a duration the player can read.
  const duration = await page.locator('audio').evaluate(async (a: HTMLAudioElement) => {
    if (a.readyState < 1) await new Promise((r) => a.addEventListener('loadedmetadata', r, { once: true }));
    return a.duration;
  });
  expect(duration).toBeGreaterThan(30);

  // Transcript hidden by default for a sleep lesson; chapters jump.
  await expect(page.getByLabel('Transcript')).toHaveCount(0);
  await page.getByRole('button', { name: '☰ Chapters' }).click();
  await page.getByRole('button', { name: /寄 jì/ }).click();
  await expect(page.locator('.al-now-chapter')).toHaveText('寄 jì');
  await page.getByRole('button', { name: '📝 Transcript' }).click();
  await expect(page.getByLabel('Transcript').getByText('我想寄一封信。').first()).toBeVisible();
  // After the word's three sentences: ONE English recap line, the word inside it.
  await expect(page.getByLabel('Transcript').getByText('The word was 寄: to send by post, as in posting a letter, not sending a text message.')).toBeVisible();

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.getByRole('button', { name: 'Sleep timer' }).click();
  await page.getByRole('menuitem', { name: '15 min' }).click();
  await expect(page.getByRole('button', { name: 'Sleep timer' })).toContainText(/1[45]:\d\d/);
  await page.getByRole('button', { name: 'Pause' }).click();

  // Offline (in the app — the dev server has no service worker for a full reload): the list
  // and the saved lesson still open and play.
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Back to audio lessons' }).click();
  await page.getByRole('button', { name: 'Play 银行和邮局' }).click();
  await expect(page.getByText('✓ Saved on this phone · plays offline')).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.context().setOffline(false);
});

test('a dialogue lesson lists its chapters and shows the transcript', async ({ authenticatedPage: page }) => {
  test.setTimeout(120_000);
  await page.gotoAuthenticated('/audio-lessons');
  await page.getByLabel('What situation do you want to practise?').fill('Ordering at a Lanzhou noodle shop');
  await page.getByRole('button', { name: '🎧 Make the lesson' }).click();
  const row = page.getByRole('button', { name: /^Play / }).first();
  await expect(row).toBeVisible({ timeout: 60000 });
  await row.click();
  await expect(page.getByText('🎙️ Dialogue lesson')).toBeVisible();
  // Transcript on by default, with the English under the Chinese.
  await expect(page.getByLabel('Transcript').getByText('我要一碗牛肉面。').first()).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: '☰ Chapters' }).click();
  for (const title of ['Introduction', 'First listen', 'Second listen', 'Third listen, a little slower', 'Line by line', 'Final listen']) {
    await expect(page.locator('.al-chapters').getByText(title, { exact: true })).toBeVisible();
  }
});

test('the private podcast feed: copy, fetch like a podcast app, Range, reset', async ({ authenticatedPage: page }) => {
  test.setTimeout(120_000);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.gotoAuthenticated('/audio-lessons');
  await page.getByRole('radio', { name: /Sleep/ }).click();
  await page.getByLabel(/Paste some Chinese/).fill('我家旁边有一个邮局，邮局在银行旁边。我常常去邮局给妈妈寄信。');
  await page.getByRole('button', { name: '🎧 Make the lesson' }).click();
  await expect(page.getByRole('button', { name: 'Play 银行和邮局' })).toBeVisible({ timeout: 60000 });

  await page.getByTestId('al-podcast-link').click();
  await expect(page).toHaveURL(/\/settings#podcast-feed$/);
  const section = page.getByTestId('podcast-feed');
  // Shown masked; Copy copies the whole link.
  await expect(section.getByTestId('podcast-feed-url')).toContainText(/\/api\/podcast\/[A-Za-z0-9_-]{4}…[A-Za-z0-9_-]{4}\/feed\.xml/, { timeout: 30000 });
  await section.getByTestId('podcast-feed-copy').click();
  await expect(section.getByTestId('podcast-feed-copy')).toHaveText('✓ Copied');
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(/\/api\/podcast\/[A-Za-z0-9_-]{43}\/feed\.xml$/);
  await expect(section.getByRole('link', { name: 'Open in podcast app' })).toHaveAttribute('href', url.replace(/^https?:/, 'podcast:'));

  // What a podcast app does: no cookies, no login.
  const app = await playwrightRequest.newContext();
  const feed = await app.get(url);
  expect(feed.status()).toBe(200);
  expect(feed.headers()['content-type']).toContain('application/rss+xml');
  const xml = await feed.text();
  expect(xml).toContain('<title>银行和邮局</title>');
  const enclosure = /<enclosure url="([^"]+)" length="(\d+)" type="audio\/mpeg"\/>/.exec(xml);
  expect(enclosure).not.toBeNull();
  const part = await app.get(enclosure![1], { headers: { Range: 'bytes=0-1023' } });
  expect(part.status()).toBe(206);
  expect(part.headers()['content-range']).toBe(`bytes 0-1023/${enclosure![2]}`);
  expect((await part.body()).length).toBe(1024);

  // Reset: the old link (feed and file) stops working at once.
  page.once('dialog', (d) => d.accept());
  await section.getByTestId('podcast-feed-reset').click();
  await expect(async () => {
    await section.getByTestId('podcast-feed-copy').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).not.toBe(url);
  }).toPass({ timeout: 15000 });
  expect((await app.get(url)).status()).toBe(404);
  expect((await app.get(enclosure![1])).status()).toBe(404);
  const fresh = await page.evaluate(() => navigator.clipboard.readText());
  expect((await app.get(fresh)).status()).toBe(200);
  await app.dispose();
});
