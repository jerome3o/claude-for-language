import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * "🎯 Mini lesson on this mistake" (Sentence Coach; shared/coach/mistakeLesson.ts). E2E_TEST_MODE's
 * fake check corrects 我昨天去了商店买东西了 and the fake writer returns a short lesson:
 * - check → the chip → the lesson card → ▶ Do it plays it in the player (nothing recorded) → a
 *   rating at the end saves it WITH that run as its completion → it is in Mini Lessons, scheduled;
 * - "Save to my mini lessons" without doing it → a NEW lesson in Mini Lessons, no completion;
 * - a sentence that was already right gets no chip.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const WRONG = '我昨天去了商店买东西了';

interface SeededUser { id: string; token: string }

async function api<T = unknown>(request: APIRequestContext, path: string, token: string): Promise<T> {
  const res = await request.get(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok()) throw new Error(`GET ${path} → ${res.status()}`);
  return (await res.json()) as T;
}

async function seedUser(request: APIRequestContext, tag: string): Promise<SeededUser> {
  const email = `mistake-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const res = await request.post(`${API}/api/test/auth`, { data: { email, name: 'Jerome' } });
  expect(res.ok()).toBeTruthy();
  const r = (await res.json()) as { user: { id: string }; session_token: string };
  return { id: r.user.id, token: r.session_token };
}

async function openAs(browser: Browser, user: SeededUser, path: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}session_token=${user.token}`);
  return page;
}

async function shoot(page: Page, name: string) {
  if (!process.env.SHOOT) return;
  await page.waitForTimeout(500);
  await page.screenshot({ path: `../docs/pr-screenshots/coach-mistake-lesson/${name}.png` });
}

type LessonList = { lessons: Array<{ id: string; title: string; source: string; completions: Array<{ rating: number | null }> }> };

async function check(page: Page, sentence: string) {
  await page.getByTestId('coach-voice-type').click(); // voice first: ✏️ Type opens the box
  await page.locator('.sentence-input-form textarea').fill(sentence);
  await page.locator('.sentence-input-form').getByTestId('coach-action-check').click();
  await expect(page).toHaveURL(/\/coach\?c=/);
}

test('check → 🎯 chip → play the lesson → a rating saves it with its completion', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const user = await seedUser(request, 'rated');
  const page = await openAs(browser, user, '/coach');
  await check(page, WRONG);
  await expect(page.getByText('Needs a little work')).toBeVisible({ timeout: 20_000 });
  const chip = page.getByTestId('coach-quick-mistake-lesson');
  await expect(chip).toHaveText('🎯 Mini lesson on this mistake');
  await shoot(page, 'web-01-chip-after-correction');

  await chip.click();
  const card = page.getByTestId('coach-lesson-card');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('🎯 Mini lesson · 4 exercises');
  await expect(card).toContainText('(E2E) One 了 is enough');
  await card.scrollIntoViewIfNeeded();
  await shoot(page, 'web-02-lesson-card');

  // Asking again opens the same lesson (never a second one).
  await expect(chip).toHaveText('🎯 Mini lesson on this mistake');

  await card.getByTestId('coach-lesson-play').click();
  await expect(page).toHaveURL(/\/coach\/[^/]+\/lesson\//);
  await expect(page.getByText('Trying it · not saved yet')).toBeVisible();
  // The note, then the exercises.
  await page.getByRole('button', { name: /next|continue|got it/i }).first().click();
  await expect(page.getByText('Which sentence is correct?')).toBeVisible();
  await shoot(page, 'web-03-exercise-in-preview');
  await page.locator('.contrast-option', { hasText: '我昨天去银行了。' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('.contrast-option', { hasText: '他昨天买书了。' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByTestId('lesson-show-answer').click();
  await page.getByRole('button', { name: '✓ Got it' }).click();

  // The end: save it with a rating.
  const save = page.getByTestId('lesson-preview-save');
  await expect(save).toContainText('Save it to your mini lessons?');
  await shoot(page, 'web-04-save-step');
  await save.getByRole('button', { name: /Good/ }).click();
  await expect(page.getByTestId('coach-lesson-saved')).toContainText('Saved to your mini lessons');
  await shoot(page, 'web-05-saved');

  const list = await api<LessonList>(request, '/api/custom-lessons?status=all', user.token);
  const lesson = list.lessons.find((l) => l.title === '(E2E) One 了 is enough');
  expect(lesson).toMatchObject({ source: 'coach' });
  expect(lesson!.completions.map((c) => c.rating)).toEqual([2]);

  // Back in the conversation the card says so; Mini Lessons has it.
  await page.getByTestId('coach-lesson-back').click();
  await expect(page.getByTestId('coach-lesson-saved-chip')).toBeVisible({ timeout: 15_000 });
  await page.goto('/lessons');
  await expect(page.getByText('(E2E) One 了 is enough').first()).toBeVisible({ timeout: 30_000 });
  await page.context().close();
});

test('Save without doing it: a new lesson in Mini Lessons; a correct sentence gets no chip', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const user = await seedUser(request, 'plain');
  const page = await openAs(browser, user, '/coach');
  await check(page, WRONG);
  await page.getByTestId('coach-quick-mistake-lesson').click();
  const card = page.getByTestId('coach-lesson-card');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByTestId('coach-lesson-save').click();
  await expect(card.getByTestId('coach-lesson-saved-chip')).toBeVisible({ timeout: 15_000 });

  const list = await api<LessonList>(request, '/api/custom-lessons?status=all', user.token);
  const lesson = list.lessons.find((l) => l.title === '(E2E) One 了 is enough');
  expect(lesson).toMatchObject({ source: 'coach', completions: [] });
  await page.goto('/lessons');
  await expect(page.getByTestId(`lesson-play-${lesson!.id}`)).toHaveText('▶ Start', { timeout: 30_000 });

  // A sentence the check finds right: no lesson to make.
  await page.goto('/coach');
  await check(page, '我们明天一起去公园吧');
  await expect(page.getByText('(E2E) Looks fine.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('coach-quick-mistake-lesson')).toHaveCount(0);
  await page.context().close();
});
