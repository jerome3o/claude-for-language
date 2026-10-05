import { test, expect, APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Local runs can point at an installed Chromium (CI installs its own).
if (process.env.PW_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } });

/**
 * "Needs your ear" — the tutor's recording review queue (/connections/:relId/recordings).
 * Four recordings with finished checks: one clean (heard right, Good, high score) stays
 * out of the queue; one heard as something else, one with a tone off, one rated Again
 * are in it. Marking one Listened takes it out; All recordings still lists all four.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(
  request: APIRequestContext,
  urlPath: string,
  opts: { method?: 'GET' | 'POST' | 'PUT'; token?: string; data?: unknown } = {},
): Promise<T> {
  const res = await request.fetch(`${API}${urlPath}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${urlPath} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function seedUser(request: APIRequestContext, tag: string, name: string): Promise<SeededUser> {
  const email = `rqueue-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

const AUDIO = fs
  .readFileSync(path.join(__dirname, '../../worker/src/services/pronunciation/__fixtures__/take-live.webm'))
  .toString('base64');

test('tutor sees only the recordings that need her ear and marks one', async ({ page, request }) => {
  test.setTimeout(120_000);
  const tutor = await seedUser(request, 'tutor', 'Minghui Wang');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  const relId = rel.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });

  await api(request, '/api/test/recordings', {
    method: 'POST',
    data: {
      user_id: student.id,
      deck_name: 'HSK 2 · 第三课',
      audio_base64: AUDIO,
      items: [
        // Clean: heard right, rated Good, scored well → not in the queue.
        { hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello', rating: 2, check: { transcript: '你好', score: 96 } },
        // Heard as something else.
        { hanzi: '银行', pinyin: 'yínháng', english: 'bank', rating: 2, check: { transcript: '音行', score: null } },
        // A tone sounded off.
        {
          hanzi: '谢谢', pinyin: 'xièxie', english: 'thank you', rating: 2,
          check: {
            transcript: '谢谢', score: 88,
            char_scores: [
              { char: '谢', score: 52, error: 'Mispronunciation', tone_suspect: true },
              { char: '谢', score: 94, error: 'None' },
            ],
          },
        },
        // Rated Again by the student.
        { hanzi: '苹果', pinyin: 'píngguǒ', english: 'apple', rating: 0, check: { transcript: '苹果', score: 93 } },
      ],
    },
  });

  // The API: 3 in the queue, 4 in all.
  const q = await api<{ counts: { queue: number; all: number } }>(request, `/api/relationships/${relId}/recordings/queue`, { token: tutor.token });
  expect(q.counts).toMatchObject({ queue: 3, all: 4 });

  await page.goto(`/connections/${relId}/recordings?session_token=${tutor.token}`);
  await expect(page.getByTestId('rq-tab-queue')).toHaveText('Needs your ear (3)', { timeout: 30_000 });
  const cards = page.getByTestId('rq-card');
  await expect(cards).toHaveCount(3);

  const bank = cards.filter({ hasText: '银行' });
  await expect(bank.getByTestId('rq-label')).toContainText(['Heard: 音行']);
  await expect(bank.getByTestId('rq-heard')).toHaveText('音行');
  await expect(bank.locator('.rq-ch-heard-wrong')).toHaveText('音');
  await expect(bank.getByRole('button', { name: 'Play their recording' })).toBeVisible();
  await expect(bank.getByRole('button', { name: 'Play reference' })).toBeVisible();

  const thanks = cards.filter({ hasText: '谢谢' });
  await expect(thanks.getByTestId('rq-label')).toContainText(['Sounded off: 谢 (tone)']);
  await expect(thanks.locator('.rq-ch-tone')).toHaveCount(1);

  const apple = cards.filter({ hasText: '苹果' });
  await expect(apple.getByTestId('rq-label')).toContainText(['Rated Again']);

  await expect(cards.filter({ hasText: '你好' })).toHaveCount(0);

  // Mark one Listened → it slides out of the queue.
  await apple.getByRole('button', { name: '✓ Listened' }).click();
  await expect(cards).toHaveCount(2);
  await expect(page.getByTestId('rq-tab-queue')).toHaveText('Needs your ear (2)');

  // All recordings: all four, the queue items badged.
  await page.getByTestId('rq-tab-all').click();
  await expect(page.getByTestId('rq-tab-all')).toHaveText('All recordings (4)');
  await expect(cards).toHaveCount(4);
  await expect(page.locator('.rq-label-queue')).toHaveCount(2);
  await expect(cards.filter({ hasText: '苹果' }).getByRole('button', { name: '✓ Listened' })).toHaveClass(/active-listened/);

  // Clear the rest → the empty queue says so and links to All recordings.
  for (const word of ['银行', '谢谢']) {
    await cards.filter({ hasText: word }).getByRole('button', { name: '✓ Listened' }).click();
    await expect(cards.filter({ hasText: word }).getByRole('button', { name: '✓ Listened' })).toHaveClass(/active-listened/);
  }
  await page.getByTestId('rq-tab-queue').click();
  await expect(page.getByTestId('rq-empty')).toContainText('Nothing needs your ear 🎧 — 4 recordings in this range sound fine');
});
