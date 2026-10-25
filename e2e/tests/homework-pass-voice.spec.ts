import { test, expect, APIRequestContext, Page } from '@playwright/test';

// These specs walk the plain pass: Hard mode in the pass (default All, docs/HOMEWORK.md §3d) is off here —
// homework-pass-hard-mode.spec.ts covers it.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pass-hard-mode-v1', 'off'));
});

/**
 * The homework pass on the STUDY CARD (docs/HOMEWORK.md §3, shared/homework/pass-card.ts): each word
 * is the read card — 🎤 Record Your Pronunciation, the take transcribed ("You said …"), Check Answer —
 * and the answer side ends in Not yet / Got it instead of Again / Hard / Good / Easy. A "You said"
 * that matched suggests Got it (ringed); nothing tried suggests nothing. The answer side carries
 * "Add to my long-term review" and the ⚡ Study it today toggle (on = bumped, off = taken out).
 * NOTHING goes to review_events and the take is not kept for upload (pendingRecordings).
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
  path: string,
  opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {},
): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function seedUser(request: APIRequestContext, tag: string, name: string): Promise<SeededUser> {
  const email = `hwvoice-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

/** The rows of a table of the app's IndexedDB. */
async function rows<T = Record<string, unknown>>(page: Page, table: string): Promise<T[]> {
  return page.evaluate(
    (store) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open('ChineseLearningDB');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction(store, 'readonly').objectStore(store).getAll();
          req.onsuccess = () => { resolve(req.result as T[]); db.close(); };
          req.onerror = () => reject(req.error);
        };
      }),
    table,
  );
}

/** Every take goes to POST /api/transcribe (no live key) and hears `heard`. */
async function routeUploads(page: Page, heard: string) {
  let uploads = 0;
  await page.route('**/api/transcribe/live', (route) => route.fulfill({ json: { provider: 'upload' } }));
  await page.route(/\/api\/transcribe$/, (route) => {
    uploads++;
    return route.fulfill({ json: { text: heard, language: 'zh' } });
  });
  return () => uploads;
}

test('the pass is the study card: record → "You said" → Got it suggested; ⚡ toggle; nothing reaches FSRS', async ({ page, request }) => {
  test.setTimeout(150_000);
  const tutor = await seedUser(request, 'tutor', 'Minghui');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: tutor.token, data: { name: 'Lesson 9 Oct' } });
  for (const n of [
    { hanzi: '银行', pinyin: 'yínháng', english: 'bank' },
    { hanzi: '学生', pinyin: 'xuésheng', english: 'student' },
  ]) {
    await api(request, `/api/decks/${deck.id}/notes`, { method: 'POST', token: tutor.token, data: n });
  }
  const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await api(request, `/api/relationships/${rel.data.id}/homework`, {
    method: 'POST', token: tutor.token, data: { items: [{ kind: 'deck', source_id: deck.id, mode: 'one_off', due_date: due }] },
  });
  const mine = await api<{ assignments: Array<{ id: string; target_id: string }> }>(request, '/api/me/homework', { token: student.token });
  const assignmentId = mine.assignments[0].id;

  const uploads = await routeUploads(page, '银行');
  // No clips in the test; don't wait for one to be made.
  await page.route('**/api/notes/*/ensure-audio', (route) => route.abort());
  await page.goto(`/?session_token=${student.token}`);
  await expect(page.getByTestId('homework-home-card')).toBeVisible({ timeout: 60_000 });
  await page.goto(`/homework/${assignmentId}`);
  const card = page.getByTestId('hw-pass-card');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('hw-pass-count')).toHaveText('0/2');
  const reviewsBefore = (await rows(page, 'reviewEvents')).length;
  const recordingsBefore = (await rows(page, 'pendingRecordings')).length;

  // Bring 银行 up first (the pass order is the tutor's): skip the other word with Not yet if needed.
  const front = card.locator('.hanzi-large');
  let wrongs = 1;
  if ((await front.textContent())?.trim() !== '银行') {
    wrongs++;
    await page.getByTestId('skip-recording').click();
    await page.getByTestId('hw-notyet').click();
    await expect(front).toHaveText('银行');
  }

  // ---- The read card's flow: Record → Stop → Check Answer → "You said" on the back.
  await expect(page.getByTestId('hw-gotit')).toHaveCount(0);
  await page.getByRole('button', { name: 'Record Your Pronunciation' }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Stop Recording' }).click();
  await page.getByRole('button', { name: 'Check Answer' }).click();
  await expect(page.getByTestId('study-card-back')).toBeVisible();
  await expect(page.getByTestId('you-said')).toContainText('银行', { timeout: 10_000 });
  expect(uploads()).toBe(1);
  // No new-character shimmer on the homework pass (flashcard session only) — this student has no
  // reviews at all, which used to make every character of the word shimmer, front and back.
  await expect(page.locator('.new-char')).toHaveCount(0);
  await expect(page.locator('.new-char-sr')).toHaveCount(0);

  // Not yet / Got it where the ratings are; the match suggests Got it (he still chooses).
  await expect(page.getByRole('button', { name: /^Good/ })).toHaveCount(0);
  await expect(page.getByTestId('hw-pass-rate')).toHaveAttribute('data-suggested', 'right');
  await expect(page.getByTestId('hw-gotit')).toHaveClass(/hw-btn--suggested/);
  await expect(page.getByTestId('hw-notyet')).not.toHaveClass(/hw-btn--suggested/);

  // ---- The answer side's choices: long-term review and the ⚡ toggle.
  const extras = page.getByTestId('hw-pass-extras');
  await expect(extras.getByTestId('hw-longterm')).toBeVisible();
  const bump = extras.getByRole('button', { name: /Study it today|Today ✓/ });
  await expect(bump).toHaveText('⚡ Study it today');
  await bump.click();
  await expect(bump).toHaveText('⚡ Today ✓');
  await expect(bump).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await rows<{ source: string; pending: string | null }>(page, 'studyBumps')).filter((b) => b.pending !== 'clear').map((b) => b.source)).toEqual(['homework_pass']);
  // Off again: taken out of today's pocket.
  await bump.click();
  await expect(bump).toHaveText('⚡ Study it today');
  await expect.poll(async () => (await rows<{ pending: string | null }>(page, 'studyBumps')).filter((b) => b.pending !== 'clear').length).toBe(0);
  // …and on, for good: it reaches the server (the one-off copy's word is first in today's study).
  await bump.click();
  await expect(bump).toHaveText('⚡ Today ✓');
  await expect
    .poll(async () => (await api<{ bumps: Array<{ hanzi: string }> }>(request, '/api/me/bumps', { token: student.token })).bumps.map((b) => b.hanzi), { timeout: 15_000 })
    .toEqual(['银行']);

  await page.getByTestId('hw-gotit').click();
  await expect(page.getByTestId('hw-pass-count')).toHaveText('1/2');

  // ---- The other word: nothing tried → nothing suggested; Not yet brings it back; Got it ends it.
  await expect(front).toHaveText('学生');
  await page.getByTestId('skip-recording').click();
  await expect(page.getByTestId('hw-pass-rate')).toHaveAttribute('data-suggested', 'none');
  await page.getByTestId('hw-notyet').click();
  await expect(front).toHaveText('学生');
  await expect(page.getByTestId('hw-gotit')).toHaveCount(0);
  await page.getByTestId('skip-recording').click();
  await page.getByTestId('hw-gotit').click();
  await expect(page.getByTestId('hw-pass-done')).toBeVisible();

  // Homework events only: no review event, no recording queued for upload.
  expect((await rows(page, 'reviewEvents')).length).toBe(reviewsBefore);
  expect((await rows(page, 'pendingRecordings')).length).toBe(recordingsBefore);
  const results = (await rows<{ result: string }>(page, 'homeworkEvents')).map((e) => e.result);
  expect(results.filter((r) => r === 'right')).toHaveLength(2);
  expect(results.filter((r) => r === 'wrong')).toHaveLength(wrongs);
});
