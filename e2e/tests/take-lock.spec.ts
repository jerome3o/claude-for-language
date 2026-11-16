import { test, expect, APIRequestContext, Page } from '@playwright/test';
import { skipFirstCardExplainer } from './fixtures/explainer';

/**
 * The take lock (docs/STUDY_SESSION.md "While a take is recording"; shared/voice/takeLock.ts): Jerome kept
 * starting a 🎤 take, then tapping what he thought ended it — but it was the screen's Next / rating / Got it
 * sitting in the same place, so the app moved on and the take was lost. While a take records, nothing on
 * the screen advances, rates, closes or navigates: the footer's primary action is a red "■ Stop recording"
 * in the same place, ✕ / back stop the take first.
 *
 * - the study card: ✕ during the read take stops it (still on the card, the take kept → Check Answer);
 *   on the answer side a sentence row's 🎤 take, then a tap exactly where Good was → the take stops, nothing
 *   is rated (no review event); browser back during a take stops it too; Good works again after.
 * - the homework pass: a tap where Got it was during a sentence take stops it — no pass answer recorded.
 */
test.use({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: process.env.SHOTS_DIR ? 2 : 1,
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  },
});

const SHOTS = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const CLUE = { sentence_clue: '我去银行取钱。', sentence_clue_pinyin: 'Wǒ qù yínháng qǔ qián.', sentence_clue_translation: 'I go to the bank to get money.' };

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

async function seedUser(request: APIRequestContext, tag: string, name: string) {
  const email = `take-lock-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

/** The rows of a table of the app's IndexedDB. */
async function count(page: Page, table: string): Promise<number> {
  return page.evaluate(
    (store) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('ChineseLearningDB');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction(store, 'readonly').objectStore(store).count();
          req.onsuccess = () => { resolve(req.result); db.close(); };
          req.onerror = () => reject(req.error);
        };
      }),
    table,
  );
}

/** Every take uploads (no live key) and hears `heard`; held until released when `hold` is set. */
async function routeTakes(page: Page, heard: string) {
  await page.route('**/api/transcribe/live', (route) => route.fulfill({ json: { provider: 'upload' } }));
  await page.route(/\/api\/transcribe$/, (route) => route.fulfill({ json: { text: heard, language: 'zh', provider: 'e2e' } }));
  await page.route('**/api/notes/*/ensure-audio', (route) => route.abort());
  await page.route('**/api/sentences/top-up', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"queued":0,"note_ids":[]}' }));
  // An exact read never reaches the answer check; anything else gets a quick stand-in verdict.
  await page.route('**/api/lessons/answer-check', (route) => route.fulfill({
    json: { check: { verdict: 'correct', headline: 'Right', corrected: '', corrected_pinyin: '', tips: [], suggested: 'got_it' }, cached: true, ms: 1 },
  }));
}

/** Opens the answer side's first sentence row (the card's own sentence) and starts its 🎤 take. */
async function startSentenceTake(page: Page) {
  const row = page.locator('.sentence-set-row').first();
  await expect(row).toBeVisible({ timeout: 15000 });
  if ((await row.locator('.sentence-set-hanzi').count()) === 0) await row.click();
  await expect(row.locator('.sentence-set-hanzi')).toHaveText(CLUE.sentence_clue);
  const mic = row.getByTestId('sentence-practise-mic');
  await mic.click();
  await expect(page.getByTestId('sentence-stop-bar')).toHaveAttribute('data-state', 'stop', { timeout: 10000 });
  await page.waitForTimeout(900);
}

test.beforeEach(async ({ context, page }) => {
  await skipFirstCardExplainer(context);
  // The plain card: no Hard mode, no sentence gate (they have their own specs).
  await page.addInitScript(() => {
    try {
      localStorage.setItem('sentence-gate-v1', 'off');
      localStorage.setItem('pass-hard-mode-v1', 'off');
    } catch { /* ignore */ }
  });
});

test('study card: ✕ / back / a tap where Good was stop the take — nothing leaves, nothing is rated', async ({ page, request }) => {
  test.setTimeout(150_000);
  await routeTakes(page, '我去银行取钱');
  const me = await seedUser(request, 'study', 'Jerome');
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: me.token, data: { name: 'Bank words' } });
  const note = await api<{ id: string }>(request, `/api/decks/${deck.id}/notes?check=none`, {
    method: 'POST', token: me.token, data: { hanzi: '银行', pinyin: 'yínháng', english: 'bank', ...CLUE },
  });
  await api(request, '/api/me/card-holds', { method: 'POST', token: me.token, data: { note_ids: [note.id], card_types: ['meaning_to_hanzi', 'audio_to_hanzi'], kind: 'suspend' } });

  await page.goto(`/decks?session_token=${me.token}`);
  await expect(page.getByText('Bank words').first()).toBeVisible({ timeout: 30000 });
  const record = page.getByRole('button', { name: 'Record Your Pronunciation' });
  await expect(async () => {
    await page.goto(`/study?deck=${deck.id}&autostart=true`);
    await expect(record).toBeVisible({ timeout: 10000 });
  }).toPass({ timeout: 90000 });

  // 1. The read take on the question: ✕ stops it instead of leaving Study.
  await record.click();
  await expect(page.getByRole('button', { name: 'Stop Recording' })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1200);
  await shot(page, '01-read-take-recording');
  await page.getByTestId('study-close').click();
  await expect(page).toHaveURL(/\/study/);
  await expect(page.getByRole('button', { name: 'Stop Recording' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check Answer' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Play Recording' })).toBeVisible(); // the take was kept

  // 2. The answer side: a sentence row's 🎤 take, then a thumb where Good was.
  await page.getByRole('button', { name: 'Check Answer' }).click();
  await expect(page.getByTestId('study-card-back')).toBeVisible({ timeout: 15000 });
  const good = page.getByTestId('rating-good');
  await expect(good).toBeVisible();
  const goodBox = (await good.boundingBox())!;
  const reviewsBefore = await count(page, 'reviewEvents');
  await startSentenceTake(page);
  // The footer's action row + ratings gave way to ■ Stop recording.
  await expect(good).toHaveCount(0);
  await expect(page.getByTestId('study-footer-stop')).toBeVisible();
  await shot(page, '02-sentence-take-footer-stop');
  await page.mouse.click(goodBox.x + goodBox.width / 2, goodBox.y + goodBox.height / 2);
  await expect(page.getByTestId('sentence-stop-bar')).toHaveCount(0, { timeout: 15000 });
  await expect(page.getByTestId('study-card-back')).toBeVisible();
  expect(await count(page, 'reviewEvents')).toBe(reviewsBefore);
  // The take was kept and judged: the row shows what was heard.
  await expect(page.locator('.sentence-set-row').first()).toContainText('我去银行取钱', { timeout: 15000 });

  // 3. Browser back (the Android back gesture) during a take stops it — still on the card.
  await startSentenceTake(page);
  await page.goBack();
  await expect(page.getByTestId('sentence-stop-bar')).toHaveCount(0, { timeout: 15000 });
  await expect(page).toHaveURL(/\/study/);
  await expect(page.getByTestId('study-card-back')).toBeVisible();
  expect(await count(page, 'reviewEvents')).toBe(reviewsBefore);

  // 4. With no take under way, Good rates as usual.
  await expect(good).toBeVisible();
  await good.click();
  await expect.poll(() => count(page, 'reviewEvents'), { timeout: 15000 }).toBe(reviewsBefore + 1);
});

test('homework pass: a tap where Got it was during a take stops it — no answer is recorded', async ({ page, request }) => {
  test.setTimeout(150_000);
  await routeTakes(page, '我去银行取钱');
  const tutor = await seedUser(request, 'tutor', 'Minghui');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: tutor.token, data: { name: 'Lesson 9 Oct' } });
  await api(request, `/api/decks/${deck.id}/notes?check=none`, {
    method: 'POST', token: tutor.token, data: { hanzi: '银行', pinyin: 'yínháng', english: 'bank', ...CLUE },
  });
  const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await api(request, `/api/relationships/${rel.data.id}/homework`, {
    method: 'POST', token: tutor.token, data: { items: [{ kind: 'deck', source_id: deck.id, mode: 'one_off', due_date: due }] },
  });
  const mine = await api<{ assignments: Array<{ id: string }> }>(request, '/api/me/homework', { token: student.token });

  await page.goto(`/?session_token=${student.token}`);
  await expect(page.getByTestId('homework-home-card')).toBeVisible({ timeout: 60_000 });
  await page.goto(`/homework/${mine.assignments[0].id}`);
  await expect(page.getByTestId('hw-pass-card')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('hw-pass-count')).toHaveText('0/1');

  // The read take on the pass card: ✕ stops it, the pass stays open.
  await page.getByRole('button', { name: 'Record Your Pronunciation' }).click();
  await expect(page.getByRole('button', { name: 'Stop Recording' })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1200);
  await page.getByTestId('study-close').click();
  await expect(page).toHaveURL(/\/homework\//);
  await expect(page.getByRole('button', { name: 'Check Answer' })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Check Answer' }).click();

  const gotIt = page.getByTestId('hw-gotit');
  await expect(gotIt).toBeVisible({ timeout: 15000 });
  const box = (await gotIt.boundingBox())!;
  const eventsBefore = await count(page, 'homeworkEvents');
  await startSentenceTake(page);
  await expect(gotIt).toHaveCount(0);
  await shot(page, '03-pass-take-footer-stop');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId('sentence-stop-bar')).toHaveCount(0, { timeout: 15000 });
  await expect(page.getByTestId('hw-pass-card')).toBeVisible();
  await expect(page.getByTestId('hw-pass-count')).toHaveText('0/1');
  expect(await count(page, 'homeworkEvents')).toBe(eventsBefore);

  // Then Got it answers as usual.
  await gotIt.click();
  await expect.poll(() => count(page, 'homeworkEvents'), { timeout: 15000 }).toBe(eventsBefore + 1);
});
