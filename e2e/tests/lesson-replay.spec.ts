import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * Mini lessons: closing never completes, and "▶ Do it again" (docs/STUDY_SESSION.md).
 * - Closing a lesson on its intro (✕) records nothing, and the lesson is offered again.
 * - The Mini Lessons page plays any lesson: a lesson that isn't due offers "Practice only"
 *   (nothing recorded); rating the replay is a normal completion.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

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
  const email = `replay-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  return { id: r.user.id, token: r.session_token };
}

const spec = (title: string) => ({
  title,
  icon: '✈️',
  sections: [{
    exercises: [{
      type: 'note',
      title: '坐地铁还是打车？',
      body: '还是 asks "or" in a question: 我们坐地铁还是打车？',
      sentences: [{ hanzi: '我们坐地铁还是打车？', pinyin: 'Wǒmen zuò dìtiě háishi dǎchē?', english: 'Shall we take the metro or a taxi?' }],
    }],
  }],
});

async function createLesson(request: APIRequestContext, user: SeededUser, title: string): Promise<string> {
  const created = await api<{ lesson: { id: string } } | { id: string }>(request, '/api/custom-lessons', { method: 'POST', token: user.token, data: { spec: spec(title) } });
  return 'lesson' in created ? created.lesson.id : created.id;
}

async function ratings(request: APIRequestContext, user: SeededUser, lessonId: string): Promise<Array<number | null>> {
  const list = await api<{ lessons: Array<{ id: string; completions?: Array<{ rating: number | null; completed_at: string }> }> }>(request, '/api/custom-lessons?status=all', { token: user.token });
  const comps = list.lessons.find(l => l.id === lessonId)?.completions ?? [];
  return [...comps].sort((a, b) => a.completed_at.localeCompare(b.completed_at)).map(c => c.rating);
}

async function readTheNote(page: Page) {
  await page.getByRole('button', { name: /next|continue|got it/i }).first().click();
  await expect(page.getByText('How well do you know this material now?')).toBeVisible();
}

test('closing a lesson on its intro records nothing; it is offered again', async ({ page, request }) => {
  test.setTimeout(120_000);
  const user = await seedUser(request, 'close');
  const id = await createLesson(request, user, 'China trip 1 · Arriving at Pudong');

  for (let i = 0; i < 2; i++) {
    await page.goto(`/study?autostart=true&session_token=${user.token}`);
    await expect(page.getByText('China trip 1 · Arriving at Pudong').first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'End session' }).click();
    await expect(page).not.toHaveURL(/\/study/);
  }
  await page.waitForTimeout(1500);
  expect(await ratings(request, user, id)).toEqual([]);

  // Still today's lesson, and still "New" on the Mini Lessons page with ▶ Start.
  await page.goto(`/lessons?session_token=${user.token}`);
  await expect(page.getByTestId(`lesson-play-${id}`)).toHaveText('▶ Start', { timeout: 30_000 });
});

test('▶ Do it again: Practice only records nothing, a rating is a normal completion', async ({ page, request }) => {
  test.setTimeout(150_000);
  const user = await seedUser(request, 'again');
  const id = await createLesson(request, user, 'China trip 2 · Checking in');

  // Finish it once in Study (Good → back in two weeks).
  await page.goto(`/study?autostart=true&session_token=${user.token}`);
  await expect(page.getByText('China trip 2 · Checking in').first()).toBeVisible({ timeout: 30_000 });
  await readTheNote(page);
  await page.locator('.study-rating-sticky').getByRole('button', { name: /Good/ }).click();
  await expect.poll(() => ratings(request, user, id), { timeout: 30_000 }).toEqual([2]);

  // The Mini Lessons page plays it again; it isn't due, so Practice only is offered.
  await page.goto(`/lessons?session_token=${user.token}`);
  const play = page.getByTestId(`lesson-play-${id}`);
  await expect(play).toHaveText('▶ Do it again', { timeout: 30_000 });
  await play.click();
  await expect(page).toHaveURL(new RegExp(`/lessons/${id}/play`));
  await expect(page.getByText('Mini lesson · again')).toBeVisible();
  await readTheNote(page);
  await page.getByTestId('lesson-practice-only').click();
  await expect(page.getByTestId('lesson-replay-done')).toContainText('Practice done');
  await page.waitForTimeout(1500);
  expect(await ratings(request, user, id)).toEqual([2]);

  // Again, and this time rate it: a normal completion (the attempt goes with it).
  await page.goto(`/lessons/${id}/play?from=lessons_page&session_token=${user.token}`);
  await readTheNote(page);
  await page.locator('.study-rating-sticky').getByRole('button', { name: /Easy/ }).click();
  await expect(page.getByTestId('lesson-replay-done')).toContainText('Saved');
  await expect.poll(() => ratings(request, user, id), { timeout: 30_000 }).toEqual([2, 3]);
});
