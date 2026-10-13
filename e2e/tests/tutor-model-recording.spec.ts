import { test, expect, APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The tutor's model recording on a needs-work mark (docs/RECORDING_REVIEW.md "Model recordings"):
 * on the recordings page she opens "+ Note · 🎤", writes a note, records how it should sound
 * (fake microphone), hears it back and saves — the mark is needs-work with her clip. The student
 * sees "▶ Minghui Wang says it" · "▶ You" on the Tutor notes page and on the back of that card
 * (the practice route), and only the two of them can fetch the clip.
 */
test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  },
});

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
  const email = `model-rec-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

const AUDIO = fs
  .readFileSync(path.join(__dirname, '../../worker/src/services/pronunciation/__fixtures__/take-live.webm'))
  .toString('base64');

test('the tutor records how it should sound; the student hears it next to their own take', async ({ page, request, browser }) => {
  test.setTimeout(180_000);
  const tutor = await seedUser(request, 'tutor', 'Minghui Wang');
  const student = await seedUser(request, 'student', 'Jerome');
  const stranger = await seedUser(request, 'stranger', 'Someone');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  const relId = rel.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });

  const seeded = await api<{ events: Array<{ id: string; card_id: string }> }>(request, '/api/test/recordings', {
    method: 'POST',
    data: {
      user_id: student.id,
      deck_name: 'HSK 2 · 第三课',
      audio_base64: AUDIO,
      items: [{ hanzi: '银行', pinyin: 'yínháng', english: 'bank', rating: 1, check: { transcript: '音行', score: null } }],
    },
  });
  const eventId = seeded.events[0].id;

  // ---- The tutor: + Note · 🎤 → note → 🎤 Record it → Stop → ▶ → Save ----
  await page.goto(`/connections/${relId}/recordings?session_token=${tutor.token}`);
  const card = page.getByTestId('rq-card').filter({ hasText: '银行' });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: '+ Note · 🎤' }).click();
  await card.getByLabel('Note for the student').fill('银 is 2nd tone — listen to mine.');
  await card.getByTestId('model-recorder-start').click();
  await expect(card.getByTestId('model-recorder-stop')).toBeVisible();
  await page.waitForTimeout(1500);
  await card.getByTestId('model-recorder-stop').click();
  await expect(card.getByTestId('model-recorder-play-draft')).toBeVisible();
  await expect(card.getByTestId('rq-save')).toHaveText('Needs work + recording');
  const uploaded = page.waitForResponse((r) => r.url().includes(`/recordings/${eventId}/mark/audio`) && r.request().method() === 'PUT');
  await card.getByTestId('rq-save').click();
  expect((await uploaded).status()).toBe(200);

  // Marked → out of the queue; under All recordings the mark shows her clip.
  await page.getByTestId('rq-tab-all').click();
  const marked = page.getByTestId('rq-card').filter({ hasText: '银行' });
  await expect(marked.getByTestId('rq-model-play')).toBeVisible();
  await expect(marked.getByRole('button', { name: '⚠ Needs work' })).toHaveClass(/active-needs-work/);

  // ---- The API: the note carries the clip; only the two of them can fetch it ----
  const feed = await api<{ notes: Array<{ event_id: string; model_audio_url: string | null; recording_url: string | null }> }>(
    request, '/api/me/recording-notes', { token: student.token },
  );
  const note = feed.notes.find((n) => n.event_id === eventId)!;
  expect(note.model_audio_url).toMatch(new RegExp(`^/api/recording-marks/${eventId}/model-audio\\?v=`));
  expect(note.recording_url).toBe(`recordings/${eventId}.webm`);
  for (const [who, status] of [[student, 200], [tutor, 200], [stranger, 404]] as const) {
    const res = await request.fetch(`${API}${note.model_audio_url}`, { headers: { Authorization: `Bearer ${who.token}` } });
    expect(res.status()).toBe(status);
  }
  // Never through the public audio route.
  const key = await request.fetch(`${API}/api/audio/tutor-recordings/${relId}/x.webm`);
  expect(key.status()).toBe(404);

  // ---- The student: the Tutor notes page, then the card back ----
  // His own device (a fresh browser context: nothing cached from the tutor's session).
  const studentCtx = await browser.newContext();
  const studentPage = await studentCtx.newPage();
  // The sync downloads the clip for offline (so the tap may play it from the device cache).
  const clipStatuses: number[] = [];
  studentPage.on('response', (r) => { if (r.url().includes(`/api/recording-marks/${eventId}/model-audio`)) clipStatuses.push(r.status()); });
  await studentPage.goto(`/tutor-notes?session_token=${student.token}`);
  const row = studentPage.getByTestId('tutor-note').filter({ hasText: '银行' });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.getByTestId('model-rec-tutor')).toHaveText(/Minghui Wang says it/);
  await expect(row.getByTestId('model-rec-mine')).toHaveText(/You/);
  await row.getByTestId('model-rec-tutor').click();
  await expect.poll(() => clipStatuses.includes(200), { timeout: 30_000 }).toBe(true);
  await expect(row.getByTestId('model-rec-tutor')).not.toContainText('needs a connection');

  await row.getByTestId('tn-practice').click();
  await studentPage.getByRole('button', { name: 'Skip recording' }).click({ timeout: 30_000 });
  const check = studentPage.getByRole('button', { name: 'Check Answer' });
  if (await check.isVisible().catch(() => false)) await check.click();
  const back = studentPage.getByTestId('tutor-note-line');
  await expect(back).toContainText('银 is 2nd tone — listen to mine.');
  await expect(back.getByTestId('model-rec-tutor')).toHaveText(/Minghui Wang says it/);
  await expect(back.getByTestId('model-rec-mine')).toBeVisible();
  await studentCtx.close();
});
