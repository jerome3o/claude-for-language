import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * The homework pass's example sentence behaves like the study card's sentence
 * rows (SentenceSet variant="pass"): the Chinese is up, a tap adds the pinyin,
 * the next the English and the tools; "What's going on here?" shows the same
 * word-by-word breakdown (from the device cache — offline — when it has one),
 * each word opens the language explorer (+ Add as card inside); the generated set waits behind
 * "+ N more sentences". None of it writes a review event or a homework event:
 * only Got it / Not yet do (a homework event).
 */

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
  const email = `hwsent-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

/** How many rows a table of the app's IndexedDB holds. */
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

const CLUE = '老师喜欢在课上和学生互动。';

test('the pass sentence: reveal, breakdown, add a word — and nothing is recorded', async ({ page, request }) => {
  test.setTimeout(120_000);
  const tutor = await seedUser(request, 'tutor', 'Minghui');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  const relId = rel.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });

  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: tutor.token, data: { name: 'Lesson vocab 30 Sep' } });
  await api(request, `/api/decks/${deck.id}/notes`, {
    method: 'POST',
    token: tutor.token,
    data: {
      hanzi: '互动', pinyin: 'hùdòng', english: 'to interact; interaction',
      sentence_clue: CLUE,
      sentence_clue_pinyin: 'Lǎoshī xǐhuan zài kè shang hé xuésheng hùdòng.',
      sentence_clue_translation: 'The teacher likes to interact with the students in class.',
    },
  });
  const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await api(request, `/api/relationships/${relId}/homework`, {
    method: 'POST', token: tutor.token, data: { items: [{ kind: 'deck', source_id: deck.id, mode: 'one_off', due_date: due }] },
  });
  const mine = await api<{ assignments: Array<{ id: string }> }>(request, '/api/me/homework', { token: student.token });
  const assignmentId = mine.assignments[0].id;

  await page.goto(`/?session_token=${student.token}`);
  await expect(page.getByTestId('homework-home-card')).toBeVisible({ timeout: 60_000 });
  // Explained once before (study card / Coach): the breakdown is cached on this device.
  await page.evaluate(
    ({ hanzi }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('ChineseLearningDB');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('sentenceTextExplanations', 'readwrite');
          tx.objectStore('sentenceTextExplanations').put({
            key: hanzi,
            explanation: JSON.stringify({
              words: [
                { hanzi: '老师', pinyin: 'lǎoshī', gloss: 'teacher' },
                { hanzi: '喜欢', pinyin: 'xǐhuan', gloss: 'to like' },
                { hanzi: '互动', pinyin: 'hùdòng', gloss: 'to interact' },
              ],
              construction: '喜欢 + a whole activity: 在课上和学生互动.',
            }),
            cached_at: Date.now(),
          });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { hanzi: CLUE },
  );
  const reviewsBefore = await countRows(page, 'reviewEvents');

  await page.goto(`/homework/${assignmentId}`);
  await expect(page.getByTestId('hw-pass-card')).toBeVisible({ timeout: 30_000 });
  // The face is inert: taps on the card never turn it — only Show answer does.
  await page.getByTestId('hw-pass-card').click({ position: { x: 8, y: 8 } });
  await page.getByTestId('hw-pass-card').getByText('互动', { exact: true }).click();
  await expect(page.getByTestId('hw-show')).toBeVisible();
  await expect(page.getByTestId('hw-gotit')).toHaveCount(0);
  await page.getByTestId('hw-show').click();

  const sentences = page.locator('.sentence-set--pass');
  await expect(sentences).toBeVisible();
  await expect(sentences.locator('.sentence-set-hanzi')).toHaveText(CLUE);
  await expect(sentences.locator('.sentence-set-en')).toHaveCount(0);
  await expect(sentences.locator('.sentence-set-next')).toHaveText('Tap for pinyin');
  await sentences.locator('.sentence-set-reveal').click();
  await expect(sentences.locator('.sentence-set-pinyin')).toContainText('xǐhuan');
  await expect(sentences.locator('.sentence-set-next')).toHaveText('Tap for English');
  await sentences.locator('.sentence-set-reveal').click();
  await expect(sentences.locator('.sentence-set-translation')).toContainText('interact with the students');
  // The cached breakdown is up without a network call; + Add as card for the whole sentence.
  const breakdown = sentences.getByTestId('sentence-word-breakdown');
  await expect(breakdown).toBeVisible();
  await expect(breakdown.locator('.sentence-set-word')).toHaveCount(3);
  await expect(sentences.getByRole('button', { name: '+ Add as card' })).toBeVisible();
  // A word opens the language explorer's Word view; adding it goes through the add sheet.
  await breakdown.getByRole('button', { name: 'Explore 喜欢' }).click();
  const wordView = page.getByRole('dialog', { name: 'The word 喜欢' });
  await expect(wordView).toBeVisible();
  await wordView.getByTestId('explorer-add-card').click();
  await expect(page.locator('.add-chunk-backdrop')).toBeVisible();
  await page.locator('.add-chunk-backdrop').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.add-chunk-backdrop')).toHaveCount(0);
  await page.getByTestId('explorer-close').click();
  await expect(page.getByTestId('explorer')).toHaveCount(0);

  // Nothing recorded: no review, no homework event; still this word, still turned over.
  expect(await countRows(page, 'reviewEvents')).toBe(reviewsBefore);
  expect(await countRows(page, 'homeworkEvents')).toBe(0);
  await expect(page.getByTestId('hw-pass-count')).toHaveText('0/1');
  await expect(page.getByTestId('hw-gotit')).toBeVisible();

  // Got it works as before: one homework event, still no review.
  await page.getByTestId('hw-gotit').click();
  await expect(page.getByTestId('hw-pass-done')).toBeVisible();
  expect(await countRows(page, 'homeworkEvents')).toBe(1);
  expect(await countRows(page, 'reviewEvents')).toBe(reviewsBefore);
});

/**
 * A third of the card sentences were written without pinyin or English (MCP-added / older notes).
 * The row must still reveal like the set rows: Chinese → the device's pinyin → the English, fetched
 * once from explain-text (only the line is kept), with "From the card" out of the English's way.
 */
test('a card sentence with no pinyin or English still reveals both', async ({ page, request }) => {
  test.setTimeout(120_000);
  const BARE = '服务员，我们要点菜。';
  const tutor = await seedUser(request, 'tutor', 'Minghui');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  const relId = rel.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: tutor.token, data: { name: 'Restaurant' } });
  await api(request, `/api/decks/${deck.id}/notes`, {
    method: 'POST',
    token: tutor.token,
    data: { hanzi: '点菜', pinyin: 'diǎn cài', english: 'to order food', sentence_clue: BARE },
  });
  const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await api(request, `/api/relationships/${relId}/homework`, {
    method: 'POST', token: tutor.token, data: { items: [{ kind: 'deck', source_id: deck.id, mode: 'one_off', due_date: due }] },
  });
  const mine = await api<{ assignments: Array<{ id: string }> }>(request, '/api/me/homework', { token: student.token });

  let explainCalls = 0;
  await page.route('**/api/sentences/explain-text', async (route) => {
    explainCalls++;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        explanation: {
          words: [{ hanzi: '服务员', pinyin: 'fúwùyuán', gloss: 'waiter' }],
          construction: '要 + verb: want to.',
          translation: "Waiter, we'd like to order.",
        },
      }),
    });
  });

  await page.goto(`/?session_token=${student.token}`);
  await expect(page.getByTestId('homework-home-card')).toBeVisible({ timeout: 60_000 });
  await page.goto(`/homework/${mine.assignments[0].id}`);
  await expect(page.getByTestId('hw-pass-card')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('hw-show').click();

  const sentences = page.locator('.sentence-set--pass');
  await expect(sentences.locator('.sentence-set-hanzi')).toHaveText(BARE);
  await expect(sentences.locator('.sentence-set-corner')).toHaveText('From the card');
  await expect(sentences.locator('.sentence-set-next')).toHaveText('Tap for pinyin');
  await sentences.locator('.sentence-set-reveal').click();
  await expect(sentences.locator('.sentence-set-pinyin')).toContainText('cài');
  await expect(sentences.locator('.sentence-set-next')).toHaveText('Tap for English');
  await sentences.locator('.sentence-set-reveal').click();
  await expect(sentences.locator('.sentence-set-translation')).toHaveText("Waiter, we'd like to order.");
  await expect(sentences.getByRole('button', { name: '+ Add as card' })).toBeVisible();
  // The badge is a tab on the row's top edge: it covers none of the row's lines and not ▶.
  const badgeBox = await sentences.locator('.sentence-set-corner').boundingBox();
  expect(badgeBox).not.toBeNull();
  for (const sel of ['.sentence-set-hanzi', '.sentence-set-pinyin', '.sentence-set-translation', '.sentence-set-play']) {
    const box = await sentences.locator(sel).first().boundingBox();
    expect(box, sel).not.toBeNull();
    const apart = badgeBox!.x + badgeBox!.width <= box!.x || box!.x + box!.width <= badgeBox!.x
      || badgeBox!.y + badgeBox!.height <= box!.y || box!.y + box!.height <= badgeBox!.y;
    expect(apart, `"From the card" clear of ${sel}`).toBe(true);
  }
  // Only the line was kept: the breakdown waits for "What's going on here?".
  await expect(sentences.getByTestId('sentence-word-breakdown')).toHaveCount(0);
  await expect(sentences.getByRole('button', { name: 'What’s going on here?' })).toBeVisible();
  expect(explainCalls).toBe(1);
});
