import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { ALL_STRUCTURES_NOTE } from '../../shared/lesson/__fixtures__/structures';
import { sampleLesson } from '../../shared/lesson/samples';

/**
 * "▶ Watch the intro" on a structure card (docs/STUDY_SESSION.md "Structure intro"). Jerome, Nov 2026: "a little
 * video with just the text on the screen, a few example sentences … a voice maybe talking over … introducing the
 * concepts with very simple things like, today we're going to learn about this sentence structure … in Chinese …
 * using simple language". The card's intro plays in the 🎬 Clips player: a title, the pattern building up, the
 * examples with their parts lit as they are read, a closing line; captions with 拼 / EN; nothing plays before ▶.
 */
test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined } });

const API = process.env.E2E_API_URL || 'http://localhost:8787';

function silentWav(seconds: number, rate = 8000): Buffer {
  const samples = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples * 2, 40);
  return buf;
}

async function seedLesson(request: APIRequestContext, spec: unknown): Promise<{ token: string; id: string }> {
  const email = `structure-intro-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await request.post(`${API}/api/test/auth`, { data: { email, name: 'Jerome' } });
  if (!auth.ok()) throw new Error(`auth ${auth.status()}`);
  const token = ((await auth.json()) as { session_token: string }).session_token;
  const res = await request.post(`${API}/api/custom-lessons`, { headers: { Authorization: `Bearer ${token}` }, data: { spec } });
  if (!res.ok()) throw new Error(`create lesson ${res.status()} ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { lesson?: { id: string }; id?: string };
  return { token, id: body.lesson?.id ?? body.id! };
}

/** Records every TTS text asked for (the intro's voice-over goes through practice TTS) and answers with silence. */
async function watchSpeech(page: Page): Promise<string[]> {
  const texts: string[] = [];
  await page.route('**/api/practice/tts', async (route) => {
    try { texts.push(String((route.request().postDataJSON() as { text?: string }).text ?? '')); } catch { /* not JSON */ }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ audio_base64: silentWav(0.6).toString('base64'), content_type: 'audio/wav' }),
    });
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __plays: number };
    w.__plays = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) { w.__plays++; return play.call(this); };
  });
  return texts;
}
const plays = (page: Page) => page.evaluate(() => (window as unknown as { __plays: number }).__plays);

test('the catalogue sample: ▶ Watch the intro plays its own simple-Chinese voice-over, then Done', async ({ page, request }) => {
  const texts = await watchSpeech(page);
  const { token, id } = await seedLesson(request, sampleLesson('note')!.spec);
  await page.goto(`/lessons/${id}/play?from=lessons_page&session_token=${token}`);

  const card = page.getByTestId('structure-card');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('structure-intro')).toHaveCount(0);
  await page.waitForTimeout(1200);
  expect(await plays(page)).toBe(0); // nothing plays by itself

  await card.getByTestId('structure-intro-play').click();
  const intro = page.getByTestId('structure-intro');
  await expect(intro).toBeVisible();
  // The title scene, captioned in Chinese with its English line.
  await expect(intro).toContainText('新句型');
  await expect(intro.getByTestId('clip-caption-en').first()).toBeVisible({ timeout: 10_000 });
  // The intro's own lines (the sample's `intro`), the pattern and an example with its parts coloured.
  await expect.poll(() => texts.includes('今天我们学“把”字句。'), { timeout: 15_000 }).toBe(true);
  await expect(intro.getByTestId('clip-pattern')).toBeVisible({ timeout: 20_000 });
  await expect(intro.locator('[data-testid="clip-pattern-example"] .sc-part[data-tone="fixed"]').first()).toHaveText('把', { timeout: 30_000 });
  // No like / save / Learn more in an intro.
  await expect(intro.getByTestId('clip-like')).toHaveCount(0);
  await expect(intro.getByTestId('clip-learn-more')).toHaveCount(0);

  // It ends on Done · ↻ Watch again; Done closes it and the card is still there.
  await expect(intro.getByTestId('clip-intro-done')).toBeVisible({ timeout: 60_000 });
  await expect(intro.getByTestId('clip-intro-replay')).toBeVisible();
  await intro.getByTestId('clip-intro-done').click();
  await expect(page.getByTestId('structure-intro')).toHaveCount(0);
  await expect(page.getByTestId('structure-card')).toBeVisible();
});

test('an older lesson\'s parsed structure gets a template intro; ✕ closes it', async ({ page, request }) => {
  const texts = await watchSpeech(page);
  const spec = { title: '天冷起来了', icon: '🍂', sections: [{ title: '结构一览', exercises: [ALL_STRUCTURES_NOTE] }] };
  const { token, id } = await seedLesson(request, spec);
  await page.goto(`/lessons/${id}/play?from=lessons_page&session_token=${token}`);

  const card = page.getByTestId('structure-card');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByTestId('structure-intro-play').click();
  const intro = page.getByTestId('structure-intro');
  await expect(intro).toBeVisible();
  await expect.poll(() => texts.some((t) => t.startsWith('今天我们学一个新句型')), { timeout: 15_000 }).toBe(true);
  await page.getByTestId('structure-intro-close').click();
  await expect(page.getByTestId('structure-intro')).toHaveCount(0);
  await expect(page.getByTestId('structure-card')).toContainText('1 / 5');
});
