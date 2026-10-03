import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * Today is the session (docs/STUDY_SESSION.md): ✕ just leaves (no "End session?"), the card
 * left on screen comes back revealed; ⋯ → Sentence coach and "Back to your card" return to it;
 * emptying today's queue shows today's numbers and is celebrated once — going back later is quiet.
 *
 * Self-contained: seeds a user, a deck (no secondary cards, so one card is today's whole
 * queue) and one note through the E2E test-auth endpoint and the public API.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

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

async function revealReadCard(page: Page) {
  const skip = page.getByTestId('skip-recording');
  await expect(skip).toBeVisible({ timeout: 30000 });
  const gotIt = page.getByRole('button', { name: 'Got it' });
  await page.waitForTimeout(500);
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await skip.click();
  await expect(page.getByTestId('study-card-back')).toBeVisible();
}

test('leaving Study keeps the card; the coach and back; celebrate today once', async ({ page, request }) => {
  const email = `resume-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Resume learner' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: '周末计划' } });
  await api(request, `/api/decks/${deck.id}/settings`, { method: 'PUT', token, data: { new_cards_per_day: 1, secondary_cards_per_day: 0 } });
  await api(request, `/api/decks/${deck.id}/notes`, {
    method: 'POST', token, data: { hanzi: '打算', pinyin: 'dǎsuàn', english: 'to plan; to intend', fun_facts: '打 (dǎ) to do · 算 (suàn) to reckon' },
  });

  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('周末计划').first()).toBeVisible({ timeout: 30000 });
  const studyUrl = `/study?deck=${deck.id}&autostart=true`;
  await page.goto(studyUrl);
  await revealReadCard(page);

  // ✕ just leaves: no "End session?" confirm.
  await page.getByTestId('study-close').click();
  await expect(page).not.toHaveURL(/\/study/);
  await expect(page.getByText('End session?')).toHaveCount(0);

  // Back to Study: the same card, still revealed (nothing re-asked).
  await page.goto(studyUrl);
  await expect(page.getByTestId('study-card-back')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('study-card-back')).toContainText('to plan; to intend');

  // ⋯ → Sentence coach: the card's word in the box, not sent; "Back to your card" returns to it.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: /Sentence coach/ }).click();
  await expect(page).toHaveURL(/\/coach/);
  await expect(page.locator('textarea').first()).toHaveValue('打算');
  await page.getByTestId('coach-back-to-card').click();
  await expect(page.getByTestId('study-card-back')).toBeVisible({ timeout: 30000 });

  // Easy → today's queue is empty: celebrated, with today's numbers where the recap was.
  // (force: the feedback button floats over the rating row at phone width)
  await page.getByRole('button', { name: /^Easy/ }).first().dispatchEvent('click');
  await expect(page.getByTestId('study-done')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('study-done')).toContainText('All Done!');
  await expect(page.getByTestId('study-today')).toContainText(/Today: .* · 1 review/);

  // Back to Study later with nothing due: the quiet finish, no second celebration.
  await page.goto('/decks');
  await page.goto(studyUrl);
  await expect(page.getByTestId('study-done')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('study-done')).toContainText('All done for now');
});

test('✕ goes back to the page Study was opened from — Study is never left under Home', async ({ page, request }) => {
  const email = `leave-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Leave learner' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: '周末计划' } });
  await api(request, `/api/decks/${deck.id}/notes`, {
    method: 'POST', token, data: { hanzi: '打算', pinyin: 'dǎsuàn', english: 'to plan; to intend', fun_facts: '打 (dǎ) to do · 算 (suàn) to reckon' },
  });

  await page.goto(`/?session_token=${token}`);
  await expect(page.getByText(/[1-9]\d* cards? due/)).toBeVisible({ timeout: 30000 });
  // Home → Study → ✕, twice: it used to push a new "/" each time, leaving Study under Home.
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: "Study today's cards" }).click();
    await expect(page.getByTestId('study-close')).toBeVisible({ timeout: 30000 });
    // The first card's one-time explainer may sit over the screen.
    const gotIt = page.getByRole('button', { name: 'Got it' });
    await page.waitForTimeout(500);
    if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
    await page.getByTestId('study-close').click();
    await expect(page).not.toHaveURL(/\/study/);
  }
  // The phone's back gesture from Home must not bring a study screen back.
  await page.goBack().catch(() => null);
  await page.waitForTimeout(500);
  await expect(page).not.toHaveURL(/\/study/);
});
