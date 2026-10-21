import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * "Pause new cards on heavy days" (shared/decks/review-load.ts): with more reviews due
 * today than the limit, no new cards — Home says why. The learner turns it on in
 * Settings; the tutor can set it from the student page, whose row then says the student
 * is paused today. The pause alone posts no chat message.
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

async function seedUser(request: APIRequestContext, tag: string, name: string): Promise<SeededUser> {
  const email = `revcap-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

const REVIEW_WORDS: Array<[string, string, string]> = [
  ['银行', 'yínháng', 'bank'], ['学校', 'xuéxiào', 'school'], ['医院', 'yīyuàn', 'hospital'], ['商店', 'shāngdiàn', 'shop'],
  ['公园', 'gōngyuán', 'park'], ['图书馆', 'túshūguǎn', 'library'], ['飞机', 'fēijī', 'plane'], ['火车', 'huǒchē', 'train'],
  ['电脑', 'diànnǎo', 'computer'], ['手机', 'shǒujī', 'mobile phone'], ['朋友', 'péngyou', 'friend'], ['老师', 'lǎoshī', 'teacher'],
];

/** 12 words each reviewed once three days ago (due again now) + a deck of 3 unseen words. */
async function seedReviews(request: APIRequestContext, token: string) {
  const reviews = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'Old words' } });
  const events = [];
  for (const [hanzi, pinyin, english] of REVIEW_WORDS) {
    const note = await api<{ id: string }>(request, `/api/decks/${reviews.id}/notes`, { method: 'POST', token, data: { hanzi, pinyin, english } });
    const { cards } = await api<{ cards: Array<{ id: string; card_type: string }> }>(request, `/api/notes/${note.id}`, { token });
    const card = cards.find((c) => c.card_type === 'hanzi_to_meaning') ?? cards[0];
    events.push({ id: `e2e-revcap-${card.id}`, card_id: card.id, rating: 2, reviewed_at: new Date(Date.now() - 3 * 86_400_000).toISOString() });
  }
  await api(request, '/api/reviews', { method: 'POST', token, data: { events } });
  const fresh = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'New words' } });
  for (const [hanzi, pinyin, english] of [['熊猫', 'xióngmāo', 'panda'], ['苹果', 'píngguǒ', 'apple'], ['咖啡', 'kāfēi', 'coffee']]) {
    await api(request, `/api/decks/${fresh.id}/notes`, { method: 'POST', token, data: { hanzi, pinyin, english } });
  }
}

test('the learner pauses new cards on heavy days; Home says why', async ({ page, request }) => {
  test.setTimeout(150_000);
  const me = await seedUser(request, 'learner', 'Jerome');
  await seedReviews(request, me.token);

  await page.goto(`/settings?session_token=${me.token}`);
  const section = page.getByTestId('daily-budget');
  const cap = section.getByTestId('review-cap');
  await expect(cap).toBeVisible({ timeout: 30_000 });
  await expect(cap.getByTestId('review-cap-input')).toBeDisabled();
  await cap.getByTestId('review-cap-toggle').check();
  await expect(cap.getByTestId('review-cap-input')).toHaveValue('100');
  // Out of range: Save waits.
  await cap.getByTestId('review-cap-input').fill('5');
  await expect(cap).toContainText('A number from 10 to 1000');
  await expect(section.getByTestId('budget-save')).toBeDisabled();
  await cap.getByTestId('review-cap-input').fill('10');
  await section.getByTestId('budget-save').click();
  await expect(section.getByTestId('budget-save')).toHaveText('Saved ✓');

  const after = await api<{ study_budget: { pause_new_when_reviews_over: number | null } }>(request, '/api/auth/me', { token: me.token });
  expect(after.study_budget.pause_new_when_reviews_over).toBe(10);

  // Home: 12 reviews due today > 10 → no new cards, and the line saying so.
  await expect(async () => {
    await page.goto('/');
    await expect(page.getByTestId('home-new-paused')).toContainText('New cards paused — 12 reviews due today (limit 10)', { timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.getByTestId('home-new-paused')).toContainText('Up next waits too');

  // Turned off again: the line goes.
  await page.goto('/settings');
  await page.getByTestId('review-cap-toggle').uncheck();
  await page.getByTestId('budget-save').click();
  await expect(page.getByTestId('budget-save')).toHaveText('Saved ✓');
  await page.goto('/');
  await expect(page.getByRole('button', { name: "Study today's cards" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('home-new-paused')).toHaveCount(0);
});

test('the tutor sets the pause; the student page says the student is paused today, no chat message', async ({ page, request }) => {
  test.setTimeout(150_000);
  const tutor = await seedUser(request, 'tutor', 'Minghui Wang');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  const relId = rel.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });
  await seedReviews(request, student.token);

  await page.goto(`/connections/${relId}?session_token=${tutor.token}`);
  const row = page.getByTestId('daily-budget-row');
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByTestId('daily-budget-edit').click();
  const sheet = page.getByTestId('daily-budget-sheet');
  await sheet.getByTestId('tutor-review-cap-toggle').check();
  await sheet.getByTestId('tutor-review-cap-input').fill('10');
  await sheet.getByTestId('daily-budget-save').click();
  await expect(sheet).toBeHidden();
  await expect(row.getByTestId('daily-budget-cap')).toHaveText('Pauses new cards on days with more than 10 reviews due');
  await expect(row.getByTestId('daily-budget-paused')).toHaveText('⏸ New cards paused today · 12 reviews due', { timeout: 30_000 });

  // The student's account has it; no chat message for the pause alone.
  const me = await api<{ study_budget: { pause_new_when_reviews_over: number; set_by_tutor: boolean } }>(request, '/api/auth/me', { token: student.token });
  expect(me.study_budget).toMatchObject({ pause_new_when_reviews_over: 10, set_by_tutor: true });
  const convs = await api<{ id: string }[] | { data: { id: string }[] }>(request, `/api/relationships/${relId}/conversations`, { token: student.token });
  const list = Array.isArray(convs) ? convs : convs.data;
  if (list.length > 0) {
    const msgs = await api(request, `/api/conversations/${list[0].id}/messages`, { token: student.token });
    expect(JSON.stringify(msgs)).not.toContain('new cards');
  }
});
