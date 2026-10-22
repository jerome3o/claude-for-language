import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * Mini lessons: runs that are never lost, a retry round, revise until right first time
 * (shared/study/lessonRun.ts, shared/study/lessonRevision.ts; docs/STUDY_SESSION.md "Mini lessons").
 * - Home lists a new lesson with its size; a half-done run survives a reload the NEXT DAY
 *   ("Continue where you left off (2 of 3)"); a miss comes back in the retry round with the
 *   orange part of the bar; the completion's outcome keeps the miss → "Revision coming";
 * - a revision due shows on Home ("🔁 … Revision 1 · 1 question"), plays only what was missed
 *   (+ its note), and all right first time → done for good;
 * - mini lessons are never offered in the study session.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const DAY = 86_400_000;

interface SeededUser { id: string; token: string }

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function seedUser(request: APIRequestContext, tag: string): Promise<SeededUser> {
  const email = `revision-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  return { id: r.user.id, token: r.session_token };
}

const TITLE = 'China trip 1 · Arriving at Pudong';
const spec = {
  title: TITLE,
  icon: '✈️',
  sections: [{
    exercises: [
      {
        type: 'note',
        title: '坐地铁还是打车？',
        body: '还是 asks "or" in a question: 我们坐地铁还是打车？',
        sentences: [{ hanzi: '我们坐地铁还是打车？', pinyin: 'Wǒmen zuò dìtiě háishi dǎchē?', english: 'Shall we take the metro or a taxi?' }],
      },
      { type: 'choice', question: 'Which one asks "metro or taxi?"', options: [{ hanzi: '坐地铁还是打车？' }, { hanzi: '坐地铁或者打车。' }], correct: 0 },
      { type: 'choice', question: 'Which one means "by metro"?', options: [{ hanzi: '坐地铁' }, { hanzi: '坐出租车' }], correct: 0 },
    ],
  }],
};

type Lessons = { lessons: Array<{ id: string; completions?: Array<{ id: string; rating: number | null; outcome: { keys: string[]; missed: string[] } | null }> }> };

async function createLesson(request: APIRequestContext, user: SeededUser): Promise<string> {
  const created = await api<{ lesson: { id: string } } | { id: string }>(request, '/api/custom-lessons', { method: 'POST', token: user.token, data: { spec } });
  return 'lesson' in created ? created.lesson.id : created.id;
}

async function completions(request: APIRequestContext, user: SeededUser, id: string) {
  const list = await api<Lessons>(request, '/api/custom-lessons?status=all', { token: user.token });
  return list.lessons.find(l => l.id === id)?.completions ?? [];
}

async function pick(page: Page, text: string) {
  await page.locator('.contrast-option', { hasText: text }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
}

test('a run survives the next day, the miss comes back in the retry round, and the lesson comes back as a revision', async ({ page, request }) => {
  test.setTimeout(150_000);
  const user = await seedUser(request, 'run');
  const id = await createLesson(request, user);
  const start = Date.now();
  await page.clock.install({ time: new Date(start) });

  // Home: the new lesson with its size.
  await page.goto(`/?session_token=${user.token}`);
  const row = page.getByTestId('home-hw-row').filter({ hasText: TITLE });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.getByTestId('hw-size')).toHaveText('3 exercises · ~1 min');
  await row.click();

  // The note, then a wrong answer — then close.
  await page.getByRole('button', { name: /next|continue|got it/i }).first().click();
  await pick(page, '坐地铁或者打车。');
  await expect(page.getByText('Which one means "by metro"?')).toBeVisible();
  await page.getByRole('button', { name: 'Close lesson' }).click();
  expect(await completions(request, user, id)).toEqual([]);

  // The next day, a fresh page: it continues where it was.
  await page.clock.setSystemTime(new Date(start + DAY + 3_600_000));
  await page.goto(`/lessons/${id}/play?from=home`);
  await expect(page.getByTestId('lesson-resume')).toContainText('Continue where you left off (3 of 3)', { timeout: 30_000 });
  await expect(page.getByTestId('lesson-run-bar-badge')).toHaveText('↺ 1');
  await pick(page, '坐地铁');

  // The retry round: the missed one again, until right.
  await expect(page.getByTestId('lesson-retry-line')).toContainText("Let's put this one right");
  await expect(page.getByText('Which one asks "metro or taxi?"')).toBeVisible();
  await pick(page, '坐地铁还是打车？');
  await expect(page.getByTestId('lesson-end-line')).toContainText('Back in a week as a revision');
  await page.getByTestId('lesson-done').click();

  await expect.poll(async () => (await completions(request, user, id)).map(c => c.outcome?.missed), { timeout: 30_000 }).toEqual([['s0e1']]);
  await page.goto('/lessons');
  await expect(page.getByText(/Revision coming \(1\)/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(`lesson-play-${id}`)).toHaveText('▶ Revise now');
});

test('a revision due is on Home, plays what was missed, and all right first time is done for good', async ({ page, request }) => {
  test.setTimeout(150_000);
  const user = await seedUser(request, 'due');
  const id = await createLesson(request, user);
  // A run eight days ago that missed the first question.
  await api(request, '/api/custom-lessons/offline-complete', {
    method: 'POST', token: user.token,
    data: { events: [{ id: `c-${Date.now()}`, lesson_id: id, correct: 1, total: 2, completed_at: new Date(Date.now() - 8 * DAY).toISOString(), outcome: { keys: ['s0e1', 's0e2'], missed: ['s0e1'] } }] },
  });

  await page.goto(`/?session_token=${user.token}`);
  const row = page.getByTestId('home-hw-row').filter({ hasText: TITLE });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText('Revision 1');
  await expect(row.getByTestId('hw-due')).toHaveText('due today');
  // The missed question + one got right (at least one comes back), with the note before them.
  await expect(row.getByTestId('hw-size')).toHaveText(/2 questions · ~1 min/);
  await row.click();

  await expect(page.getByText('Mini lesson · revision')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /next|continue|got it/i }).first().click(); // the note
  await pick(page, '坐地铁还是打车？');
  await pick(page, '坐地铁');
  await expect(page.getByTestId('lesson-end-line')).toContainText('done for good');
  await page.getByTestId('lesson-done').click();

  await expect.poll(async () => (await completions(request, user, id)).length, { timeout: 30_000 }).toBe(2);
  await page.goto('/lessons');
  await expect(page.getByText(/Done for good \(1\)/)).toBeVisible({ timeout: 30_000 });
});

test('mini lessons are never offered in the study session', async ({ page, request }) => {
  test.setTimeout(90_000);
  const user = await seedUser(request, 'session');
  await createLesson(request, user);
  await page.goto(`/lessons?session_token=${user.token}`);
  await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 30_000 });
  await page.goto('/study?autostart=true');
  await page.waitForTimeout(3000);
  await expect(page.getByText(TITLE)).toHaveCount(0);
});
