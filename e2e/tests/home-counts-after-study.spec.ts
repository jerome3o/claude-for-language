import { test, expect, APIRequestContext } from '@playwright/test';
import { skipFirstCardExplainer } from './fixtures/explainer';

// The first-card explainer is not what this test is about (fixtures/explainer.ts).
test.beforeEach(async ({ context }) => skipFirstCardExplainer(context));

/**
 * Back on Home after a study session (Jerome, Nov 2026: "The home screen still shows the previous
 * cached values before I started the study session … then after a little bit of loading, it shows
 * the zeros"). Home must paint the post-session numbers on its FIRST frame — the session's own
 * numbers (shared/study/homeCounts.ts) or the shared live count (services/queueCountsStore.ts) —
 * never the counts from before the session, and without waiting for a sync: the sync routes hang
 * from the moment Study opens.
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

test('finishing the day → Done → Home shows nothing due on its first paint', async ({ page, request }) => {
  const email = `home-counts-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Home counts learner' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: '周末计划' } });
  // One card is today's whole queue (no purple cards).
  await api(request, `/api/decks/${deck.id}/settings`, { method: 'PUT', token, data: { new_cards_per_day: 1, secondary_cards_per_day: 0 } });
  await api(request, `/api/decks/${deck.id}/notes`, {
    method: 'POST', token, data: { hanzi: '打算', pinyin: 'dǎsuàn', english: 'to plan; to intend', fun_facts: '打 (dǎ) to do · 算 (suàn) to reckon' },
  });

  // Home before the session: 1 card due (also what the old cache kept).
  await page.goto(`/?session_token=${token}`);
  await expect(page.getByText(/^1 card due/)).toBeVisible({ timeout: 30000 });

  // From here on the sync never answers: Home must not need it.
  const hang = () => new Promise<void>(() => {});
  await page.route('**/api/sync/**', hang);
  await page.route('**/api/reviews**', hang);

  await page.getByRole('button', { name: "Study today's cards" }).click();
  const skip = page.getByTestId('skip-recording');
  await expect(skip).toBeVisible({ timeout: 30000 });
  await skip.click();
  await expect(page.getByTestId('study-card-back')).toBeVisible();
  await page.getByRole('button', { name: /^Easy/ }).first().dispatchEvent('click');
  await expect(page.getByTestId('study-done')).toBeVisible({ timeout: 30000 });

  // Watch every frame from the moment Done is pressed: the old count must never appear.
  await page.evaluate(() => {
    const w = window as unknown as { __staleSeen?: string[] };
    w.__staleSeen = [];
    const check = () => {
      const m = document.body.innerText.match(/\b[1-9]\d* cards? due\b/);
      if (m) w.__staleSeen!.push(m[0]);
    };
    new MutationObserver(check).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page).not.toHaveURL(/\/study/);

  // The first paint already says done (no "Loading cards…" wait for the recount).
  await expect(page.getByRole('button', { name: '✓ Flashcards done' })).toBeVisible({ timeout: 2000 });
  await page.waitForTimeout(1500);
  await expect(page.getByRole('button', { name: '✓ Flashcards done' })).toBeVisible();
  const stale = await page.evaluate(() => (window as unknown as { __staleSeen?: string[] }).__staleSeen ?? []);
  expect(stale).toEqual([]);
});
