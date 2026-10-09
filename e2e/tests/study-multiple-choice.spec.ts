import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * Multiple choice on the typing cards: ONE tap flips the card, with whatever
 * has been picked so far. A partial answer is recorded as the picks in row
 * order (skipped rows left out) and shown row by row on the back; with
 * nothing picked the button reads "Show answer" and the review carries no
 * answer at all, like an empty typed card.
 *
 * Self-contained: seeds a user, a deck and one note through the E2E test-auth
 * endpoint and the public API; the option generation (an AI call) is stubbed
 * with page.route.
 */

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

const OPTIONS = [
  { correct: '图', options: ['团', '图', '国', '圆'] },
  { correct: '书', options: ['韦', '节', '书', '朽'] },
  { correct: '馆', options: ['官', '管', '馆', '棺'] },
];

/** Review events on this device with their card type (straight from IndexedDB). */
async function localReviews(page: Page): Promise<Array<{ card_type: string; user_answer: string | null; rating: number }>> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('ChineseLearningDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const idb = open.result;
      const tx = idb.transaction(['reviewEvents', 'cards'], 'readonly');
      const events = tx.objectStore('reviewEvents').getAll();
      const cards = tx.objectStore('cards').getAll();
      tx.oncomplete = () => {
        const typeOf = new Map((cards.result as Array<{ id: string; card_type: string }>).map(c => [c.id, c.card_type]));
        resolve((events.result as Array<{ card_id: string; user_answer: string | null; rating: number; reviewed_at: string }>)
          .sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at))
          .map(e => ({ card_type: typeOf.get(e.card_id) ?? '?', user_answer: e.user_answer, rating: e.rating })));
      };
    };
  }));
}

/**
 * Rate reading cards Good until a typing card comes up, then open its options
 * (the "Multiple Choice" button, or "Show Options" on a listen card).
 */
async function openNextMultipleChoice(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  const skip = page.getByTestId('skip-recording');
  const mcButton = page.getByRole('button', { name: 'Multiple Choice' });
  const showOptions = page.getByRole('button', { name: 'Show Options' });
  const nothingDue = page.getByText('Nothing due right now');
  const studyUrl = page.url();
  for (let i = 0; i < 10; i++) {
    await expect(skip.or(mcButton).or(showOptions).or(nothingDue).first()).toBeVisible({ timeout: 30000 });
    // The session can be built before the first sync has every card of the note on the device:
    // the other card types come up once Study is opened again.
    if (await nothingDue.isVisible().catch(() => false)) {
      await page.goto(studyUrl);
      continue;
    }
    if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
    if (await showOptions.isVisible().catch(() => false)) { await showOptions.click(); break; }
    if (await mcButton.isVisible().catch(() => false)) { await mcButton.click(); break; }
    // A new account gets the first-card explainer over the first card, a moment later.
    await page.waitForTimeout(500);
    if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
    // A listen card's "Show Options" can land a moment later (its options load in the background):
    // look again rather than waiting for a read card's Skip that isn't coming.
    if (!(await skip.isVisible().catch(() => false))) continue;
    await skip.click();
    await page.getByRole('button', { name: /^Good/ }).first().click();
  }
  await expect(page.getByTestId('mc-grid')).toBeVisible({ timeout: 15000 });
}

test('multiple choice: one tap, partial answer, and "Show answer" with nothing picked', async ({ page, request }) => {
  const email = `mc-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'MC learner' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: '图书馆练习' } });
  const note = await api<{ id: string }>(request, `/api/decks/${deck.id}/notes`, {
    method: 'POST', token, data: { hanzi: '图书馆', pinyin: 'túshūguǎn', english: 'library' },
  });

  // Stub the AI option generation: the note comes back with options on it.
  await page.route('**/api/notes/*/generate-multiple-choice', async (route) => {
    const fresh = await api<Record<string, unknown>>(request, `/api/notes/${note.id}`, { token });
    await route.fulfill({ json: { ...fresh, multiple_choice_options: JSON.stringify(OPTIONS) } });
  });

  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('图书馆练习').first()).toBeVisible({ timeout: 30000 });
  await page.goto(`/study?deck=${deck.id}&autostart=true`);

  // ---- First typing card: pick 图 (right) and 节 (wrong), leave 馆 blank, submit
  await openNextMultipleChoice(page);
  const submit = page.getByTestId('mc-submit');
  await expect(submit).toHaveText('Show answer');
  await page.getByRole('button', { name: '图', exact: true }).click();
  await expect(submit).toHaveText('Submit');
  await page.getByRole('button', { name: '节', exact: true }).click();
  await submit.click();

  // One tap: straight to the answer side, no check / continue step
  const diff = page.getByTestId('mc-answer-diff');
  await expect(diff).toBeVisible();
  await expect(page.getByTestId('mc-grid')).toHaveCount(0);
  await expect(diff.locator('[data-status="right"]')).toHaveText('图');
  await expect(diff.locator('[data-status="wrong"]')).toHaveText('节');
  await expect(diff.locator('[data-status="skipped"]')).toHaveCount(1);
  await expect(diff).toContainText('1 of 3 left blank');
  await page.getByRole('button', { name: /^Hard/ }).first().click();

  // ---- Second typing card: nothing picked → "Show answer" gives up and flips
  await openNextMultipleChoice(page);
  await expect(page.getByTestId('mc-submit')).toHaveText('Show answer');
  await page.getByTestId('mc-submit').click();
  await expect(page.getByTestId('study-action-row')).toBeVisible();
  await expect(page.getByTestId('mc-answer-diff')).toHaveCount(0);
  await page.getByRole('button', { name: /^Again/ }).first().click();

  // The review events carry the partial answer, then no answer at all
  await expect.poll(async () => (await localReviews(page)).filter(r => r.card_type !== 'hanzi_to_meaning').length, { timeout: 10000 }).toBe(2);
  const typingReviews = (await localReviews(page)).filter(r => r.card_type !== 'hanzi_to_meaning');
  expect(typingReviews[0]).toMatchObject({ user_answer: '图节', rating: 1 });
  expect(typingReviews[1]).toMatchObject({ user_answer: null, rating: 0 });
});

/** A whole sentence (Jerome, 2026-09-28): 14 rows to pick, one with a pinyin "xi" the model once offered. */
const LONG_OPTIONS = [
  ['我', '或', '找', '成', '战'], ['们', '间', '闷', '问', '门'], ['一', '二', '七', '十', '丁'], ['边', '连', '过', '远', '进'],
  ['吃', '吓', '叫', '吹', '喝'], ['晚', '晓', '晨', '晴', '免'], ['饭', '馆', '饮', '饿', '饱'], ['，'],
  ['一', '二', '丁', '七', '十'], ['边', '连', '过', '进', '远'], ['练', '连', '链', '炼'], ['习', '学', '刁', 'xi', '羽'],
  ['说', '诉', '读', '话', '讲'], ['中', '申', '种', '钟', '仲'], ['文', '闻', '纹', '交', '又'], ['。'],
].map(([correct, ...rest]) => ({ correct, options: [correct, ...rest] }));

test('multiple choice: a long sentence scrolls with the button on screen, characters only', async ({ page, request }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  const email = `mc-long-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'MC learner' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: '长句练习' } });
  const note = await api<{ id: string }>(request, `/api/decks/${deck.id}/notes`, {
    method: 'POST', token,
    data: { hanzi: '我们一边吃晚饭，一边练习说中文。', pinyin: 'Wǒmen yībiān chī wǎnfàn, yībiān liànxí shuō Zhōngwén.', english: 'We practise speaking Chinese while we eat dinner.' },
  });
  await page.route('**/api/notes/*/generate-multiple-choice', async (route) => {
    const fresh = await api<Record<string, unknown>>(request, `/api/notes/${note.id}`, { token });
    await route.fulfill({ json: { ...fresh, multiple_choice_options: JSON.stringify(LONG_OPTIONS) } });
  });

  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('长句练习').first()).toBeVisible({ timeout: 30000 });
  await page.goto(`/study?deck=${deck.id}&autostart=true`);
  await openNextMultipleChoice(page);

  // Never a pinyin syllable among the characters
  await expect(page.getByRole('button', { name: 'xi', exact: true })).toHaveCount(0);

  // The button is on screen without scrolling the page, and stays there
  const submit = page.getByTestId('mc-submit');
  await expect(submit).toBeInViewport();
  const rows = page.getByTestId('mc-rows');
  await rows.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(submit).toBeInViewport();
  await rows.locator('.mc-row').last().getByRole('button', { name: '文', exact: true }).click();
  await expect(submit).toHaveText('Submit');
  await submit.click();
  await expect(page.getByTestId('mc-answer-diff')).toContainText('13 of 14 left blank');
});
