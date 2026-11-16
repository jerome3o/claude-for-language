import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { ALL_STRUCTURES_NOTE } from '../../shared/lesson/__fixtures__/structures';
import { sampleLesson } from '../../shared/lesson/samples';

/**
 * Structure cards (docs/STUDY_SESSION.md "Structure cards"). Jerome, Nov 2026, on a mini lesson's opening
 * "All structures" note: "a wall of text … I don't really read them … the autoplay of one of the examples …
 * pretty bleak". A note's grammar structures are now cards, one per screen — fixed words as chips, slots
 * as labelled boxes, the examples big and coloured like the pieces — and nothing plays by itself:
 * - a lesson whose note carries `patterns` (the catalogue sample) shows them as cards;
 * - an older lesson's free-text structures ("① 除了 + 名词／动词短语 +（以外），主语 + 还 + 动词" …) are
 *   parsed into the same cards, each with its example sentence matched and coloured.
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
  const email = `structure-cards-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await request.post(`${API}/api/test/auth`, { data: { email, name: 'Jerome' } });
  if (!auth.ok()) throw new Error(`auth ${auth.status()}`);
  const token = ((await auth.json()) as { session_token: string }).session_token;
  const res = await request.post(`${API}/api/custom-lessons`, { headers: { Authorization: `Bearer ${token}` }, data: { spec } });
  if (!res.ok()) throw new Error(`create lesson ${res.status()} ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { lesson?: { id: string }; id?: string };
  return { token, id: body.lesson?.id ?? body.id! };
}

/** Counts every clip the one audio player plays; TTS answered with silence. */
async function watchPlays(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __plays: string[] };
    w.__plays = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      w.__plays.push(this.currentSrc || this.src);
      return play.call(this);
    };
  });
  await page.route('**/api/practice/tts', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ audio_base64: silentWav(0.4).toString('base64'), content_type: 'audio/wav' }),
  }));
}
const plays = (page: Page) => page.evaluate(() => (window as unknown as { __plays: string[] }).__plays.length);

test('a note with patterns: pattern chips, a coloured example, nothing plays until ▶', async ({ page, request }) => {
  await watchPlays(page);
  const sample = sampleLesson('note')!;
  const { token, id } = await seedLesson(request, sample.spec);
  await page.goto(`/lessons/${id}/play?from=lessons_page&session_token=${token}`);

  const note = page.getByTestId('structure-note');
  await expect(note).toBeVisible({ timeout: 30_000 });
  await expect(note).toHaveAttribute('data-source', 'spec');
  const card = page.getByTestId('structure-card');
  await expect(card.getByTestId('structure-fixed').first()).toContainText('把');
  await expect(card.getByTestId('structure-slot')).toHaveCount(4);
  await expect(card.getByTestId('structure-slot').first()).toContainText('Subject');
  // The example is coloured part by part like the pieces: 把 as a fixed word, 作业 as the Object slot.
  const example = card.getByTestId('structure-example').first();
  await expect(example.locator('.sc-part[data-tone="fixed"]')).toHaveText('把');
  await expect(example.locator('.sc-part[data-tone="s1"]')).toHaveText('作业');
  await expect(card).toContainText('do something to the object, and it ends up done');

  // No autoplay on the note screen.
  await page.waitForTimeout(1500);
  expect(await plays(page)).toBe(0);
  await example.getByTestId('structure-play').click();
  await expect.poll(() => plays(page), { timeout: 10_000 }).toBeGreaterThan(0);

  // One structure per screen: Next shows the second, the last one continues.
  await expect(card).toContainText('1 / 2');
  await page.getByTestId('structure-next').click();
  await expect(page.getByTestId('structure-card')).toContainText('2 / 2');
  await expect(page.getByTestId('structure-card').getByTestId('structure-fixed').nth(1)).toContainText('在');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
});

test('an older lesson\'s wall of structures becomes five parsed cards with matched, coloured examples', async ({ page, request }) => {
  await watchPlays(page);
  const spec = {
    title: '天冷起来了：除了…还… · 好＋V · 概数（多）· 起来了',
    icon: '🍂',
    sections: [
      { title: '结构一览 · All structures', exercises: [ALL_STRUCTURES_NOTE] },
      { exercises: [{ type: 'translate', english: 'Besides English, what other languages can you speak?', reference_hanzi: '除了英语，你还会说什么语言？' }] },
    ],
  };
  const { token, id } = await seedLesson(request, spec);
  await page.goto(`/lessons/${id}/play?from=lessons_page&session_token=${token}`);

  const note = page.getByTestId('structure-note');
  await expect(note).toBeVisible({ timeout: 30_000 });
  await expect(note).toHaveAttribute('data-source', 'parsed');
  // No wall of text: one structure on screen, five dots.
  await expect(page.getByTestId('structure-card')).toHaveCount(1);
  await expect(page.getByRole('tab')).toHaveCount(5);
  const card = page.getByTestId('structure-card');
  await expect(card).toContainText('1 / 5');
  await expect(card.getByTestId('structure-fixed')).toHaveCount(3); // 除了 · 以外 (optional) · 还
  await expect(card.getByTestId('structure-slot')).toHaveCount(3); // Noun / Verb phrase · Subject · Verb
  await expect(card).toContainText('besides A, also B');
  const example = card.getByTestId('structure-example');
  await expect(example).toHaveCount(1);
  await expect(example.locator('.sc-part[data-tone="fixed"]').first()).toHaveText('除了');
  await expect(example.locator('.sc-part[data-tone="s0"]')).toHaveText('跑步');
  await expect(example.locator('.sc-part[data-tone="s2"]')).toHaveText('喜欢游泳');
  await page.waitForTimeout(1500);
  expect(await plays(page)).toBe(0);

  // The last structure: 形容词 + 起来了 with its own example.
  await page.getByRole('tab').nth(4).click();
  await expect(page.getByTestId('structure-card')).toContainText('5 / 5');
  await expect(page.getByTestId('structure-card').getByTestId('structure-example').locator('.sc-part[data-tone="s0"]')).toHaveText('热闹');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Besides English, what other languages can you speak?')).toBeVisible();
});
