import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Word checks (worker services/card-check.ts; E2E_TEST_MODE uses a fake Haiku that
 * knows 银行 yínxíng / 苹果 "banana", plus the real 一/不 rule):
 * - per-deck "Check for errors": ⋯ → estimate → run → review list → Apply selected
 *   (only the ticked fixes change, through the normal note update);
 * - a new word gets "⚠ Possible issue" on the deck page; Apply fix / Dismiss;
 * - a tutor checks the student's copy of a homework deck and fixes her source too.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PUT'; token?: string; data?: unknown } = {},
): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function seedUser(request: APIRequestContext, tag: string, name: string, role?: 'tutor'): Promise<SeededUser> {
  const email = `check-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name, ...(role ? { role } : {}) } });
  return { id: r.user.id, email, token: r.session_token };
}

const WORDS = [
  ['银行', 'yínxíng', 'bank'],
  ['苹果', 'píngguǒ', 'banana'],
  ['一样', 'yī yàng', 'the same'],
  ['你好', 'nǐ hǎo', 'hello'],
].map(([hanzi, pinyin, english]) => ({ hanzi, pinyin, english }));

interface DeckNote { id: string; hanzi: string; pinyin: string; english: string; check_issues: string | null }

test('Check for errors: estimate → run → review → apply only the selected fixes', async ({ page, request }) => {
  test.setTimeout(120_000);
  const user = await seedUser(request, 'own', 'Jerome');
  // A learner account: the automatic check is off by default, so the deck starts clean.
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: user.token, data: { name: 'Lesson 8 生词' } });
  await api(request, `/api/decks/${deck.id}/notes/batch`, { method: 'POST', token: user.token, data: { notes: WORDS } });

  await page.goto(`/decks/${deck.id}?session_token=${user.token}`);
  await expect(page.getByText('银行').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('check-issue')).toHaveCount(0);

  await page.locator('.deck-menu-btn').click();
  await page.getByRole('menuitem', { name: /Check for errors/ }).click();
  const sheet = page.getByTestId('deck-check-sheet');
  await expect(page.getByTestId('deck-check-estimate')).toHaveText(/^~4 words · about /);
  await page.getByTestId('deck-check-start').click();

  await expect(page.getByTestId('deck-check-summary')).toHaveText('3 possible issues in 4 words', { timeout: 60_000 });
  const rows = page.getByTestId('deck-check-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: '银行' })).toContainText('yínháng');
  await expect(rows.filter({ hasText: '苹果' })).toContainText('apple');
  await expect(rows.filter({ hasText: '一样' })).toContainText('yí yàng');

  // Leave 苹果 alone.
  await rows.filter({ hasText: '苹果' }).getByRole('checkbox').uncheck();
  await page.getByTestId('deck-check-apply').click();
  await expect(page.getByTestId('deck-check-done')).toContainText('Fixed 2 words');
  await expect(sheet.getByText('✓').first()).toBeVisible();

  const notes = await api<DeckNote[]>(request, `/api/decks/${deck.id}/notes`, { token: user.token });
  const by = (h: string) => notes.find(n => n.hanzi === h)!;
  expect(by('银行').pinyin).toBe('yínháng');
  expect(by('一样').pinyin).toBe('yí yàng');
  expect(by('苹果').english).toBe('banana');
  expect(by('你好').pinyin).toBe('nǐ hǎo');
});

test('a new word shows "⚠ Possible issue" on the deck page; Apply fix and Dismiss', async ({ page, request }) => {
  test.setTimeout(120_000);
  const user = await seedUser(request, 'auto', 'Minghui', 'tutor');
  const me = await api<{ card_check: boolean }>(request, '/api/auth/me', { token: user.token });
  expect(me.card_check).toBe(true); // on by default for tutors
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: user.token, data: { name: 'Fruit' } });
  await api(request, `/api/decks/${deck.id}/notes`, { method: 'POST', token: user.token, data: { hanzi: '苹果', pinyin: 'píngguǒ', english: 'banana' } });
  await api(request, `/api/decks/${deck.id}/notes`, { method: 'POST', token: user.token, data: { hanzi: '不是', pinyin: 'bù shì', english: 'is not' } });

  // The check runs on the queue: wait until both notes carry their issue.
  await expect.poll(async () => {
    const notes = await api<DeckNote[]>(request, `/api/decks/${deck.id}/notes`, { token: user.token });
    return notes.filter(n => n.check_issues).length;
  }, { timeout: 60_000 }).toBe(2);
  // Nothing was changed by the check itself.
  const before = await api<DeckNote[]>(request, `/api/decks/${deck.id}/notes`, { token: user.token });
  expect(before.find(n => n.hanzi === '苹果')!.english).toBe('banana');

  await page.goto(`/decks/${deck.id}?session_token=${user.token}`);
  const apple = page.locator('.deck-note-progress-item', { hasText: '苹果' });
  await expect(apple.getByTestId('check-issue')).toContainText('banana', { timeout: 60_000 });
  await expect(apple.getByTestId('check-issue')).toContainText('apple');
  await apple.getByTestId('check-issue-apply').click();
  await expect(apple.getByTestId('check-issue')).toHaveCount(0, { timeout: 20_000 });
  await expect(apple).toContainText('apple');

  const bushi = page.locator('.deck-note-progress-item', { hasText: '不是' });
  await expect(bushi.getByTestId('check-issue')).toContainText('bú shì');
  await bushi.getByTestId('check-issue-dismiss').click();
  await expect(bushi.getByTestId('check-issue')).toHaveCount(0, { timeout: 20_000 });

  const after = await api<DeckNote[]>(request, `/api/decks/${deck.id}/notes`, { token: user.token });
  expect(after.find(n => n.hanzi === '苹果')!.english).toBe('apple');
  expect(after.find(n => n.hanzi === '不是')!.pinyin).toBe('bù shì'); // dismissed, not applied
  expect(after.every(n => !n.check_issues)).toBe(true);
});

test("a tutor checks the student's copy of a homework deck and fixes her source deck too", async ({ page, request }) => {
  test.setTimeout(120_000);
  const tutor = await seedUser(request, 'tutor', 'Minghui', 'tutor');
  const student = await seedUser(request, 'student', 'Jerome');
  await api(request, '/api/profile/card-check', { method: 'PUT', token: tutor.token, data: { card_check: false } });
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  const relId = rel.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: tutor.token, data: { name: 'HSK 1 银行' } });
  await api(request, `/api/decks/${deck.id}/notes/batch`, { method: 'POST', token: tutor.token, data: { notes: WORDS.slice(0, 2) } });
  const share = await api<{ id: string; target_deck_id: string }>(request, `/api/relationships/${relId}/share-deck`, { method: 'POST', token: tutor.token, data: { deck_id: deck.id } });

  // Only the tutor.
  const forbidden = await request.fetch(`${API}/api/relationships/${relId}/shared-decks/${share.id}/check`, { headers: { Authorization: `Bearer ${student.token}` } });
  expect(forbidden.status()).toBe(403);

  await page.goto(`/connections/${relId}?session_token=${tutor.token}`);
  const row = page.locator('.td-hw-row', { hasText: 'HSK 1 银行' });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByTestId('queue-position').click();
  await page.getByTestId('queue-menu-check').click();
  await expect(page.getByTestId('deck-check-estimate')).toHaveText(/^~2 words/);
  await page.getByTestId('deck-check-start').click();
  await expect(page.getByTestId('deck-check-summary')).toHaveText('2 possible issues in 2 words', { timeout: 60_000 });
  await expect(page.getByText('Also fix my source deck')).toBeVisible();
  await page.getByTestId('deck-check-apply').click();
  await expect(page.getByTestId('deck-check-done')).toContainText('Fixed 2 words (and 2 in your deck)');

  const copy = await api<DeckNote[]>(request, `/api/decks/${share.target_deck_id}/notes`, { token: student.token });
  const source = await api<DeckNote[]>(request, `/api/decks/${deck.id}/notes`, { token: tutor.token });
  for (const list of [copy, source]) {
    expect(list.find(n => n.hanzi === '银行')!.pinyin).toBe('yínháng');
    expect(list.find(n => n.hanzi === '苹果')!.english).toBe('apple');
  }
});

test('Paste a list preview: check-words flags rows before they are saved (nothing stored)', async ({ request }) => {
  const user = await seedUser(request, 'paste', 'Minghui', 'tutor');
  const res = await api<{ issues: Array<{ index: number; field: string; proposed: string }> }>(request, '/api/ai/check-words', {
    method: 'POST', token: user.token, data: { words: [...WORDS, { hanzi: '一起', pinyin: 'yìqǐ', english: 'together' }] },
  });
  expect(res.issues.map(i => [i.index, i.field, i.proposed])).toEqual([
    [0, 'pinyin', 'yínháng'],
    [1, 'english', 'apple'],
    [2, 'pinyin', 'yí yàng'],
  ]);
});

test('Paste a list: a row with a likely mistake shows ⚠ with Apply fix, and the fix is what gets saved', async ({ page, request }) => {
  test.setTimeout(120_000);
  const user = await seedUser(request, 'pasteui', 'Minghui', 'tutor');
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: user.token, data: { name: '生词' } });
  await page.goto(`/decks/${deck.id}?session_token=${user.token}`);
  await page.locator('.header').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: /Paste (a )?list/ }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Word list').fill('银行\tyínxíng\tbank\n你好\tnǐ hǎo\thello');
  const bank = dialog.locator('.pw-row', { hasText: '银行' });
  await expect(bank.getByTestId('check-issue')).toContainText('yínháng', { timeout: 20_000 });
  await expect(dialog.locator('.pw-row', { hasText: '你好' }).getByTestId('check-issue')).toHaveCount(0);
  await bank.getByTestId('check-issue-apply').click();
  await expect(bank.getByTestId('check-issue')).toHaveCount(0);
  await dialog.getByRole('button', { name: /^Add 2$/ }).click();
  await expect(dialog.getByRole('heading', { name: 'Words saved' })).toBeVisible({ timeout: 30_000 });
  const notes = await api<DeckNote[]>(request, `/api/decks/${deck.id}/notes`, { token: user.token });
  expect(notes.find(n => n.hanzi === '银行')!.pinyin).toBe('yínháng');
});
