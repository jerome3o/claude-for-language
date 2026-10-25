import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * Hard mode in the homework pass (docs/HOMEWORK.md §3d; shared/homework/pass-angles.ts): the pass's own
 * setting is All by default — the header's 🎯 chip and "2 angles per word"; the read card's take is checked
 * on the question (✓ Right), then the Sentence round, then Got it; giving up (Skip recording) locks Got it
 * and suggests Not yet; a word got right comes back ONCE more later on its meaning card ("Second angle")
 * before it counts as done. Never a review event.
 */
test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  },
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: process.env.SHOTS_DIR ? 2 : 1,
});

const FAKE_WS = 'wss://fake-soniox.test/transcribe-websocket';
/** SHOTS_DIR=… saves the PR screenshots (412×915 at 2×) along the way. */
const SHOTS = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** Soniox stand-in: hears `window.__heard` (interim after two chunks, final after the end-of-audio frame). */
async function fakeSoniox(page: Page) {
  await page.addInitScript((fakeUrl) => {
    const Real = window.WebSocket;
    class FakeSoniox extends EventTarget {
      readyState = 0;
      onopen: ((e: Event) => void) | null = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      onclose: ((e: CloseEvent) => void) | null = null;
      private configured = false;
      private chunks = 0;
      constructor(public url: string) {
        super();
        setTimeout(() => { this.readyState = 1; this.onopen?.(new Event('open')); }, 20);
      }
      private heard() { return (window as unknown as { __heard?: string }).__heard ?? ''; }
      private reply(o: object) { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(o) })); }
      send(data: unknown) {
        if (!this.configured) { this.configured = true; return; }
        if (data !== '') {
          this.chunks++;
          if (this.chunks === 2) this.reply({ tokens: [{ text: this.heard(), is_final: false }] });
          return;
        }
        setTimeout(() => {
          this.reply({ tokens: [{ text: this.heard(), is_final: true }, { text: '<fin>', is_final: true }] });
          this.reply({ tokens: [], finished: true });
        }, 30);
      }
      close() { this.readyState = 3; }
    }
    window.WebSocket = function (url: string | URL, protocols?: string | string[]) {
      return String(url) === fakeUrl ? new FakeSoniox(String(url)) : new Real(url, protocols);
    } as unknown as typeof WebSocket;
  }, FAKE_WS);
  await page.route('**/api/transcribe/live', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      provider: 'soniox', api_key: 'snx_temp_e2e', expires_at: new Date(Date.now() + 1800e3).toISOString(),
      websocket_url: FAKE_WS, model: 'stt-rt-v5', language_hints: ['zh', 'en'],
    }),
  }));
}

const API = process.env.E2E_API_URL || 'http://localhost:8787';

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
  const email = `hwhard-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

async function countRows(page: Page, table: string): Promise<number> {
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

async function homeworkItemIds(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('ChineseLearningDB');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('homeworkEvents', 'readonly').objectStore('homeworkEvents').getAll();
          req.onsuccess = () => {
            resolve((req.result as Array<{ item_id: string; result: string; created_at: string }>).sort((a, b) => a.created_at.localeCompare(b.created_at)).map((e) => `${e.item_id.includes('#') ? 'step' : 'word'}:${e.result}`));
            db.close();
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

const SET = [
  { hanzi: '银行几点开门？', pinyin: 'Yínháng jǐ diǎn kāimén?', translation: 'What time does the bank open?' },
  { hanzi: '他在银行工作。', pinyin: 'Tā zài yínháng gōngzuò.', translation: 'He works at a bank.' },
  { hanzi: '银行旁边有一家饭馆。', pinyin: 'Yínháng pángbiān yǒu yì jiā fànguǎn.', translation: 'There is a restaurant next to the bank.' },
];

const heard = { text: '' };
async function hear(page: Page, text: string) {
  heard.text = text;
  await page.evaluate((h) => { (window as unknown as { __heard?: string }).__heard = h; }, text);
}

test('hard mode in the pass: check first, the round, a give-up locks Got it, a second angle on the meaning card', async ({ page, request }) => {
  test.setTimeout(180_000);
  await fakeSoniox(page);
  await page.route(/\/api\/transcribe$/, (route) => route.fulfill({ json: { text: heard.text, language: 'zh', provider: 'e2e' } }));
  await page.route('**/api/notes/*/ensure-audio', (route) => route.abort());
  // The words' sets, as the server would hand them out (the device has none yet); the pass's top-up asks answered.
  await page.route('**/api/notes/*/sentences', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const noteId = route.request().url().split('/api/notes/')[1].split('/')[0];
    const now = new Date().toISOString();
    const sentences = SET.map((x, i) => ({ id: `e2e-${noteId}-${i}`, note_id: noteId, position: i, ...x, audio_url: null, focus: 'core', focus_note: null, explanation: null, created_at: now, updated_at: now }));
    await route.fulfill({ json: { sentences } });
  });
  let prefetched = 0;
  await page.route('**/api/sentences/prefetch', (route) => { prefetched++; return route.fulfill({ json: { queued: 1, remaining: 0 } }); });
  await page.route('**/api/sentences/top-up', (route) => route.fulfill({ json: { queued: 0, note_ids: [] } }));

  const tutor = await seedUser(request, 'tutor', 'Minghui');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: tutor.token, data: { name: 'Lesson 25 Oct' } });
  for (const n of [
    { hanzi: '银行', pinyin: 'yínháng', english: 'bank', sentence_clue: '我去银行取钱。', sentence_clue_pinyin: 'Wǒ qù yínháng qǔ qián.', sentence_clue_translation: 'I go to the bank to get money.' },
    { hanzi: '学生', pinyin: 'xuésheng', english: 'student' },
  ]) {
    await api(request, `/api/decks/${deck.id}/notes?check=none`, { method: 'POST', token: tutor.token, data: n });
  }
  const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await api(request, `/api/relationships/${rel.data.id}/homework`, {
    method: 'POST', token: tutor.token, data: { items: [{ kind: 'deck', source_id: deck.id, mode: 'one_off', due_date: due }] },
  });
  const mine = await api<{ assignments: Array<{ id: string }> }>(request, '/api/me/homework', { token: student.token });

  await page.goto(`/?session_token=${student.token}`);
  await expect(page.getByTestId('homework-home-card')).toBeVisible({ timeout: 60_000 });
  const reviewsBefore = await countRows(page, 'reviewEvents');
  await page.goto(`/homework/${mine.assignments[0].id}`);
  const card = page.getByTestId('hw-pass-card');
  await expect(card).toBeVisible({ timeout: 30_000 });

  // The pass's own Hard mode, All by default (the session's setting untouched).
  await expect(page.getByTestId('hard-mode-chip')).toHaveAttribute('data-mode', 'all');
  await expect(page.getByTestId('hw-pass-angles')).toHaveText('🎯 2 angles per word');
  await expect.poll(() => prefetched).toBeGreaterThan(0);
  expect(await page.evaluate(() => localStorage.getItem('sentence-gate-v1'))).toBeNull();

  const front = card.locator('.hanzi-large');
  // ---- 学生 first (the tutor's order may differ): give up → Got it locked, Not yet suggested.
  const giveUp = async () => {
    await page.getByTestId('skip-recording').click();
    await expect(page.getByTestId('hw-pass-locked')).toBeVisible();
    await expect(page.getByTestId('hw-gotit')).toHaveAttribute('data-locked', 'true');
    await expect(page.getByTestId('hw-pass-rate')).toHaveAttribute('data-suggested', 'wrong');
  };
  let shotGaveUp = false;
  if ((await front.textContent())?.trim() !== '银行') {
    await giveUp();
    await shot(page, 'hwhard-03-gave-up-locked');
    shotGaveUp = true;
    await page.getByTestId('hw-gotit').click();
    await expect(page.getByTestId('hw-pass-locked')).toContainText('Got it stays locked');
    await page.getByTestId('hw-notyet').click();
    await expect(front).toHaveText('银行');
  }

  // ---- 银行: the take is checked on the question → ✓ Right → the round.
  await hear(page, '银行');
  await page.getByRole('button', { name: 'Record Your Pronunciation' }).click();
  const stop = page.getByRole('button', { name: 'Stop Recording' });
  await expect(stop).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1200);
  await stop.click();
  await page.getByRole('button', { name: 'Check Answer' }).click();
  await expect(page.getByTestId('hard-feedback')).toHaveAttribute('data-result', 'right', { timeout: 15000 });
  await shot(page, 'hwhard-01-check-right');
  const round = page.getByTestId('sentence-round');
  await expect(round).toBeVisible({ timeout: 15000 });
  await expect(round).toContainText('Got it stays open');
  await shot(page, 'hwhard-02-sentence-round');
  await page.getByTestId('sentence-round-skip').click();
  // Got it is open (skipping the round is fine) and suggested by the take.
  await expect(page.getByTestId('hw-gotit')).not.toHaveAttribute('data-locked', 'true');
  await expect(page.getByTestId('hw-pass-rate')).toHaveAttribute('data-suggested', 'right');
  await page.getByTestId('hw-gotit').click();
  // The word is not done yet: its second angle is owed.
  await expect(page.getByTestId('hw-pass-count')).toHaveText('0/2');

  // ---- 学生 (again, or for the first time): give up, Not yet.
  await expect(front).toHaveText('学生');
  await giveUp();
  if (!shotGaveUp) await shot(page, 'hwhard-03-gave-up-locked');
  await page.getByTestId('hw-notyet').click();

  // ---- 银行's second angle: the meaning card, typed, checked first, round skipped, Got it → done.
  await expect(page.getByTestId('hw-pass-angle-line')).toHaveText('🔄 Second angle · English → Chinese', { timeout: 15000 });
  await expect(card).toContainText('bank');
  await shot(page, 'hwhard-04-second-angle');
  await page.getByTestId('spoken-type').click();
  await page.locator('.study-typing-input').fill('银行');
  await page.getByRole('button', { name: 'Check Answer' }).click();
  await expect(page.getByTestId('hard-feedback')).toHaveAttribute('data-result', 'right', { timeout: 15000 });
  await expect(round).toBeVisible({ timeout: 15000 });
  await page.getByTestId('sentence-round-skip').click();
  await page.getByTestId('hw-gotit').click();
  await expect(page.getByTestId('hw-pass-count')).toHaveText('1/2');

  const events = await homeworkItemIds(page);
  expect(events.filter((e) => e === 'step:right')).toHaveLength(1);
  expect(events.filter((e) => e === 'word:right')).toHaveLength(1);
  expect(await countRows(page, 'reviewEvents')).toBe(reviewsBefore);
});
