import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * The language explorer (docs/LANGUAGE_EXPLORER.md) from the homework pass's answer side:
 * tap a character → its Character view → a word with it → the Word view (pinyin, how common,
 * a chip per character) → one of its characters → back twice → close. The word dictionary
 * endpoint answers from the static shards.
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

async function seedUser(request: APIRequestContext, tag: string, name: string) {
  const email = `explorer-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

test('homework answer side → character → word → character → back, back → close', async ({ page, request }) => {
  test.setTimeout(120_000);
  const tutor = await seedUser(request, 'tutor', 'Minghui');
  const student = await seedUser(request, 'student', 'Jerome');

  // The word dictionary: one batched call, records + the words it lacks.
  const words = await api<{ records: Record<string, { pinyin: string; syllables: string[]; rank: number | null }>; missing: string[] }>(
    request, `/api/words?w=${encodeURIComponent('银行,进行,龘龘')}`, { token: student.token },
  );
  expect(words.records['银行']).toMatchObject({ pinyin: 'yínháng', syllables: ['yín', 'háng'] });
  expect(words.missing).toEqual(['龘龘']);

  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: tutor.token, data: { name: 'Money words' } });
  await api(request, `/api/decks/${deck.id}/notes`, { method: 'POST', token: tutor.token, data: { hanzi: '银行', pinyin: 'yínháng', english: 'bank' } });
  const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await api(request, `/api/relationships/${rel.data.id}/homework`, {
    method: 'POST', token: tutor.token, data: { items: [{ kind: 'deck', source_id: deck.id, mode: 'one_off', due_date: due }] },
  });
  const mine = await api<{ assignments: Array<{ id: string }> }>(request, '/api/me/homework', { token: student.token });

  await page.goto(`/?session_token=${student.token}`);
  await expect(page.getByTestId('homework-home-card')).toBeVisible({ timeout: 60_000 });
  await page.goto(`/homework/${mine.assignments[0].id}`);
  await expect(page.getByTestId('hw-pass-card')).toBeVisible({ timeout: 30_000 });
  // The question side is not explorable; the answer side is.
  await expect(page.getByTestId('hw-pass-card').getByTestId('explorable-text')).toHaveCount(0);
  await page.getByTestId('hw-show').click();

  await page.locator('.hw-pass-hanzi .xt-tap').filter({ hasText: '行' }).click();
  const explorer = page.getByTestId('explorer');
  await expect(page.getByRole('dialog', { name: 'The character 行' })).toContainText('Words with 行');
  // The card's own word comes first; open another word with 行.
  const rows = explorer.getByTestId('char-word-row');
  await expect(rows.first()).toContainText('银行');
  await rows.filter({ hasText: '进行' }).first().click();

  const word = page.getByRole('dialog', { name: 'The word 进行' });
  await expect(word.getByTestId('explorer-word-view')).toContainText('jìnxíng');
  await expect(word.getByTestId('explorer-word-freq')).toContainText('most common word');
  await expect(explorer.locator('.xp-crumb')).toHaveText(['行', '进行']);
  await word.getByRole('button', { name: /^The character 进/ }).click();

  await expect(page.getByRole('dialog', { name: 'The character 进' })).toBeVisible();
  await expect(explorer.locator('.xp-crumb')).toHaveText(['行', '进行', '进']);

  await page.getByTestId('explorer-back').click();
  await expect(page.getByRole('dialog', { name: 'The word 进行' })).toBeVisible();
  await page.getByTestId('explorer-back').click();
  await expect(page.getByRole('dialog', { name: 'The character 行' })).toBeVisible();
  await expect(page.getByTestId('explorer-back')).toHaveCount(0);
  await page.getByTestId('explorer-close').click();
  await expect(explorer).toHaveCount(0);
  // Nothing was recorded: still the same word, still turned over.
  await expect(page.getByTestId('hw-pass-count')).toHaveText('0/1');
  await expect(page.getByTestId('hw-gotit')).toBeVisible();
});

test('a quick drill from the Word view: answer, see the score, keep exploring — no review recorded', async ({ page, request }) => {
  test.setTimeout(120_000);
  const user = await seedUser(request, 'drill', 'Jerome');
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: user.token, data: { name: 'HSK 3' } });
  await api(request, `/api/decks/${deck.id}/notes`, { method: 'POST', token: user.token, data: { hanzi: '银行', pinyin: 'yínháng', english: 'bank' } });

  await page.goto(`/decks?session_token=${user.token}`);
  await expect(page.getByText('HSK 3').first()).toBeVisible({ timeout: 30_000 });
  // The study card's answer side: a character → its words → a Word view → 🎯 Quick drill.
  await page.goto(`/study?deck=${deck.id}&autostart=true`);
  const reveal = page.getByRole('button', { name: /Skip recording|Show Answer|Check Answer|Reveal/i }).first();
  await reveal.waitFor({ timeout: 30_000 });
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  const typed = page.locator('input[type="text"], textarea').first();
  if (await typed.isVisible().catch(() => false)) await typed.fill('银行');
  await reveal.click();
  await page.getByTestId('study-action-row').waitFor({ timeout: 15_000 });
  const reviewsBefore = await page.evaluate(() => new Promise<number>((resolve) => {
    const open = indexedDB.open('ChineseLearningDB');
    open.onsuccess = () => { const r = open.result.transaction('reviewEvents').objectStore('reviewEvents').count(); r.onsuccess = () => resolve(r.result); };
  }));

  await page.locator('.diff-char-clickable, .hanzi-char-clickable').filter({ hasText: '银' }).first().click();
  await page.getByRole('dialog', { name: 'The character 银' }).getByTestId('char-word-row').filter({ hasText: '银行' }).first().click();
  const word = page.getByRole('dialog', { name: 'The word 银行' });
  await word.getByTestId('explorer-drill-start').click();

  const drill = page.getByTestId('explorer-drill');
  await expect(drill).toBeVisible();
  for (let i = 0; i < 6; i++) {
    if (await page.getByTestId('explorer-drill-done').isVisible().catch(() => false)) break;
    const options = drill.getByTestId('explorer-drill-option');
    if ((await options.count()) > 0) {
      await drill.locator('[data-right="true"]').click();
      await expect(drill.locator('.xp-drill-option.right')).toBeVisible();
    } else {
      await drill.getByRole('button', { name: 'Skip' }).click();
    }
    await drill.getByTestId('explorer-drill-next').click();
  }
  const done = page.getByTestId('explorer-drill-done');
  await expect(done).toContainText(/\d \/ \d/);
  await done.getByTestId('explorer-drill-exit').click();
  await expect(page.getByRole('dialog', { name: 'The word 银行' }).getByTestId('explorer-word-view')).toBeVisible();

  // Practice only: no review event was written.
  const reviewsAfter = await page.evaluate(() => new Promise<number>((resolve) => {
    const open = indexedDB.open('ChineseLearningDB');
    open.onsuccess = () => { const r = open.result.transaction('reviewEvents').objectStore('reviewEvents').count(); r.onsuccess = () => resolve(r.result); };
  }));
  expect(reviewsAfter).toBe(reviewsBefore);
});
