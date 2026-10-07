import { test, expect, type Page } from './fixtures/auth';

/**
 * Record again on the answer side of a read card: the card turns back to the question while the
 * new take records (the word is read from the hanzi alone, not the pinyin / English); a tap
 * anywhere on the card stops it and turns back to the answer, where the new take is
 * transcribed ("You said …"). Back / Cancel drops the new take: the answer comes back with the
 * previous take and its result. The first (front-side) Record flow is unchanged.
 * Once the new take is saved and the answer is back, the card's own clip plays (the reveal's
 * auto-play) — once; a cancelled Record again plays nothing.
 * Lab: RecordAgainFlipTest, RecordAgainAutoplayTest.
 */
test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    // A pre-installed Chromium (the remote container); unset in CI.
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  },
});

/** Every take goes to POST /api/transcribe (no live key); the n-th upload hears `heard[n]`. */
async function routeUploads(page: Page, heard: string[]) {
  const uploads: number[] = [];
  await page.route('**/api/transcribe/live', (route) => route.fulfill({ json: { provider: 'upload' } }));
  await page.route(/\/api\/transcribe$/, (route) => {
    const n = uploads.length;
    uploads.push(n);
    return route.fulfill({ json: { text: heard[Math.min(n, heard.length - 1)], language: 'zh' } });
  });
  return uploads;
}

/**
 * Counts what the card plays: its clip (any <audio> — he never taps "play my recording" here) or,
 * when the clip isn't there, the device voice reading the word.
 */
async function countCardPlays(page: Page) {
  // The starter deck has no clips in the test and none is being made ("Audio coming…" would make
  // the reveal wait for it): the card reads the word in the device voice.
  await page.route('**/api/notes/*/ensure-audio', (route) => route.abort());
  await page.addInitScript(() => {
    const w = window as unknown as { __cardPlays: string[] };
    w.__cardPlays = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      w.__cardPlays.push(this.src);
      return play.call(this);
    };
    if ('speechSynthesis' in window) {
      const speak = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.speechSynthesis.speak = (u: SpeechSynthesisUtterance) => { w.__cardPlays.push(`tts:${u.text}`); speak(u); };
    }
  });
}
const cardPlays = (page: Page) => page.evaluate(() => (window as unknown as { __cardPlays: string[] }).__cardPlays.length);

/** Study → first read card → Record → Stop → Check Answer (the unchanged front flow). */
async function firstTakeOnTheBack(page: Page) {
  const record = page.getByRole('button', { name: 'Record Your Pronunciation' });
  await expect(page.getByText(/[1-9]\d* cards? due/)).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: "Study today's cards" }).click();
  await record.waitFor({ timeout: 15000 });
  const gotIt = page.getByRole('button', { name: 'Got it', exact: true });
  await gotIt.click({ timeout: 3000 }).catch(() => {});
  await record.click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Stop Recording' }).click();
  // Still the question: the take waits for Check Answer (no flip on the front flow).
  await expect(page.getByTestId('study-card-back')).toHaveCount(0);
  await page.getByRole('button', { name: 'Check Answer' }).click();
  await expect(page.getByTestId('study-card-back')).toBeVisible();
  await expect(page.getByText(/You said: shì \(是\)/)).toBeVisible({ timeout: 5000 });
}

async function startRecordAgain(page: Page) {
  await page.getByRole('button', { name: 'Record again' }).click();
  // The question side, recording: hanzi only, no pinyin / meaning / "You said".
  await expect(page.getByTestId('study-rerecord')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('study-peek-front')).toBeVisible();
  await expect(page.getByTestId('study-card-back')).toBeHidden();
  await expect(page.getByText('Tap anywhere to stop')).toBeVisible();
  await expect(page.getByText(/You said/)).toBeHidden();
  // The ratings stay up, like a peek.
  await expect(page.getByRole('button', { name: /^Good/ })).toBeVisible();
}

test.describe('Record again flips to the question', () => {
  test.beforeEach(async ({ testUser, request }) => {
    await request.post('http://localhost:8787/api/decks/starter', { headers: { Authorization: `Bearer ${testUser.sessionToken}` } });
  });

  test('a tap on the card stops the new take and turns back to the answer, where it is transcribed and the card plays', async ({ authenticatedPage: page }) => {
    const uploads = await routeUploads(page, ['是', '大']);
    await countCardPlays(page);
    await page.gotoAuthenticated('/');
    await page.waitForSelector('.home-study-card');
    await firstTakeOnTheBack(page);
    expect(uploads.length).toBe(1);
    // The reveal's auto-play.
    await expect.poll(() => cardPlays(page)).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    const afterReveal = await cardPlays(page);

    await startRecordAgain(page);
    await page.waitForTimeout(1200);
    expect(await cardPlays(page)).toBe(afterReveal);
    // A tap on the card's face (the hanzi) — anywhere — stops it.
    await page.getByTestId('study-peek-front').locator('.hanzi').click();

    await expect(page.getByTestId('study-card-back')).toBeVisible();
    await expect(page.getByTestId('study-rerecord')).toHaveCount(0);
    await expect(page.getByText(/You said: dà \(大\)/)).toBeVisible({ timeout: 5000 });
    expect(uploads.length).toBe(2);
    await expect(page.getByRole('button', { name: 'Record again' })).toBeVisible();
    // The card's clip plays again, straight after his take — once.
    await expect.poll(() => cardPlays(page)).toBe(afterReveal + 1);
    await page.waitForTimeout(1000);
    expect(await cardPlays(page)).toBe(afterReveal + 1);
  });

  test('Stop works too, and Esc / back / Cancel drop the new take and keep the previous one', async ({ authenticatedPage: page }) => {
    const uploads = await routeUploads(page, ['是', '大']);
    await countCardPlays(page);
    await page.gotoAuthenticated('/');
    await page.waitForSelector('.home-study-card');
    await firstTakeOnTheBack(page);
    const url = page.url();
    await expect.poll(() => cardPlays(page)).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    const afterReveal = await cardPlays(page);

    // Back gesture: cancels, stays in Study, the previous "You said" is still there.
    await startRecordAgain(page);
    await page.waitForTimeout(600);
    await page.goBack();
    await expect(page.getByTestId('study-card-back')).toBeVisible();
    await expect(page.getByTestId('study-rerecord')).toHaveCount(0);
    await expect(page.getByText(/You said: shì \(是\)/)).toBeVisible();
    expect(page.url()).toBe(url);

    // Cancel button: same.
    await startRecordAgain(page);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByTestId('study-card-back')).toBeVisible();
    await expect(page.getByText(/You said: shì \(是\)/)).toBeVisible();

    // Esc: same.
    await startRecordAgain(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('study-card-back')).toBeVisible();
    await expect(page.getByText(/You said: shì \(是\)/)).toBeVisible();
    await page.waitForTimeout(500);
    expect(uploads.length).toBe(1);
    // Cancelled every time: no new take, so the card didn't play.
    expect(await cardPlays(page)).toBe(afterReveal);

    // Stop: the new take replaces it.
    await startRecordAgain(page);
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByTestId('study-card-back')).toBeVisible();
    await expect(page.getByText(/You said: dà \(大\)/)).toBeVisible({ timeout: 5000 });
    expect(uploads.length).toBe(2);
    await expect.poll(() => cardPlays(page)).toBe(afterReveal + 1);
    expect(page.url()).toBe(url);

    // Back now (not recording) leaves Study as before.
    await page.goBack();
    await expect(page).not.toHaveURL(url);
  });
});
