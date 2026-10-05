import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * "Review together" in a call (docs/RECORDING_REVIEW.md "In the call"): the student's recordings
 * that need the tutor's ear and their flagged cards, as one shared list. Either person selects; a
 * clip plays on BOTH devices (each plays it itself); the tutor's mark is a real mark.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const LAUNCH = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};
const AUDIO = fs.readFileSync(path.resolve(__dirname, '../../worker/src/services/pronunciation/__fixtures__/take-live.webm')).toString('base64');

test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'], ...LAUNCH },
  permissions: ['camera', 'microphone'],
});

async function api<T = unknown>(request: APIRequestContext, p: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${p}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${p} → ${res.status()}`);
  return (await res.json()) as T;
}

async function openAs(browser: Browser, token: string): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1280, height: 800 } });
  // Count what each device plays (the clip must play HERE, not through a screen share).
  await ctx.addInitScript(() => {
    const w = window as unknown as { __played: string[] };
    w.__played = [];
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      w.__played.push(this.src || this.currentSrc);
      return orig.call(this).catch(() => undefined);
    };
  });
  const page = await ctx.newPage();
  await page.goto(`/?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  return page;
}

async function joinCall(page: Page, callId: string) {
  await page.goto(`/calls/${callId}`);
  await expect(page.getByTestId('join-call')).toBeEnabled({ timeout: 20000 });
  await page.getByTestId('record-toggle').uncheck();
  await page.getByTestId('join-call').click();
  await page.getByTestId('call-live').waitFor({ timeout: 20000 });
}

const played = (p: Page) => p.evaluate(() => (window as unknown as { __played: string[] }).__played.filter((s) => s.includes('/api/audio/')));

test('review together: shared list and selection, clips play on both devices, the tutor marks', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const seed = async (tag: string, name: string) => {
    const email = `rev-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
    const r = await api<{ session_token: string; user: { id: string } }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
    return { email, token: r.session_token, id: r.user.id };
  };
  const tutor = await seed('tutor', '王老师');
  const student = await seed('student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
  await api(request, '/api/test/recordings', {
    method: 'POST',
    data: {
      user_id: student.id,
      audio_base64: AUDIO,
      items: [
        { hanzi: '银行', pinyin: 'yínháng', english: 'bank', rating: 2, check: { transcript: '银行', score: 74, char_scores: [{ char: '银', score: 52, error: 'Mispronunciation', tone_suspect: true }, { char: '行', score: 93, error: 'None' }] } },
        { hanzi: '买东西', pinyin: 'mǎi dōngxi', english: 'to go shopping', rating: 2, check: { transcript: '卖东西', score: 90, char_scores: [] } },
        { hanzi: '谢谢', pinyin: 'xièxie', english: 'thank you', rating: 3, check: { transcript: '谢谢', score: 97, char_scores: [] } },
      ],
    },
  });
  const { call } = await api<{ call: { id: string } }>(request, '/api/calls', { method: 'POST', token: tutor.token, data: { relationship_id: rel.data.id } });
  const tp = await openAs(browser, tutor.token);
  const sp = await openAs(browser, student.token);
  await joinCall(tp, call.id);
  await joinCall(sp, call.id);

  await tp.getByLabel('More').click();
  await tp.getByTestId('menu-activities').click();
  await tp.locator('[data-testid="activity-picker-row"][data-activity="review-together"]').click();

  for (const p of [tp, sp]) {
    await expect(p.getByTestId('review-activity')).toBeVisible({ timeout: 15000 });
    await expect(p.getByTestId('review-row')).toHaveCount(2); // 谢谢 sounded fine: not in the list
  }
  await expect(tp.getByTestId('activity-role')).toHaveText('You: Tutor');
  await expect(sp.getByTestId('activity-role')).toHaveText('You: Student');

  // The student selects the second item; the tutor's screen follows.
  const second = sp.getByTestId('review-row').nth(1);
  const secondHanzi = (await second.locator('.act-review-hanzi').textContent()) ?? '';
  await second.click();
  await expect(tp.getByTestId('review-hanzi')).toHaveText(secondHanzi, { timeout: 10000 });
  await expect(sp.getByTestId('review-hanzi')).toHaveText(secondHanzi);

  // Back to 银行; the tutor plays the student's take: it plays on both devices.
  await tp.getByTestId('review-row').filter({ hasText: '银行' }).click();
  await expect(sp.getByTestId('review-hanzi')).toHaveText('银行', { timeout: 10000 });
  await expect(sp.getByTestId('review-labels')).toContainText('Sounded off: 银 (tone)');
  const before = { t: (await played(tp)).length, s: (await played(sp)).length };
  await tp.getByTestId('review-play-recording').click();
  await expect.poll(async () => (await played(sp)).length, { timeout: 10000 }).toBeGreaterThan(before.s);
  await expect.poll(async () => (await played(tp)).length, { timeout: 10000 }).toBeGreaterThan(before.t);
  expect((await played(sp)).at(-1)).toContain('/api/audio/recordings/');
  // The student plays the reference for both.
  await sp.getByTestId('review-play-reference').click();
  await expect.poll(async () => (await played(tp)).at(-1) ?? '', { timeout: 10000 }).toContain('/api/audio/generated/');

  // Only the tutor marks.
  await expect(sp.getByTestId('review-needs-work')).toHaveCount(0);
  await tp.getByTestId('review-comment').fill('银 is second tone — rising: yín');
  await tp.getByTestId('review-needs-work').click();
  await expect(sp.getByTestId('review-verdict')).toContainText('Needs work — “银 is second tone — rising: yín”', { timeout: 10000 });

  // It is a real mark: the recordings queue no longer lists it.
  const queue = await api<{ items: Array<{ note: { hanzi: string }; mark: { status: string; comment: string } | null }> }>(request, `/api/relationships/${rel.data.id}/recordings/queue?view=all`, { token: tutor.token });
  const yinhang = queue.items.find((i) => i.note.hanzi === '银行')!;
  expect(yinhang.mark).toMatchObject({ status: 'needs_work', comment: '银 is second tone — rising: yín' });

  // Either person ends it; the summary shows the mark.
  await sp.getByTestId('activity-menu').click();
  await sp.getByTestId('activity-finish').click();
  for (const p of [tp, sp]) {
    await expect(p.getByTestId('activity-done')).toContainText('银行 (yínháng, bank)', { timeout: 10000 });
    await expect(p.getByTestId('activity-done')).toContainText('needs work: 银 is second tone');
  }
});
