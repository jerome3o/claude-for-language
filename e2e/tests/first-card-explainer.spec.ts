import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * The first-card explainer (components/onboarding/FirstCardExplainer.tsx): a brand-new learner's
 * very first card gets "Before your first card" over it; Got it dismisses it for good. Other study
 * specs mark it seen up front (fixtures/explainer.ts) — this is the one that looks at it.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

test('a brand-new learner sees the explainer over the first card; Got it dismisses it for good', async ({ page, request }) => {
  test.setTimeout(90_000);
  const email = `explainer-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'New learner' } });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: '第一课' } });
  await api(request, `/api/decks/${deck.id}/notes`, { method: 'POST', token, data: { hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello' } });

  await page.goto(`/decks?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await expect(page.getByText('第一课')).toBeVisible({ timeout: 30000 });
  await page.goto(`/study?deck=${deck.id}&autostart=true`);

  // It appears over the card (a moment after it: it waits for the device's review count).
  const explainer = page.getByRole('dialog', { name: 'Before your first card' });
  await expect(explainer).toBeVisible({ timeout: 30000 });
  await explainer.getByRole('button', { name: 'Got it' }).click();
  await expect(explainer).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Skip recording|Show Answer|Check Answer|Reveal/i }).first()).toBeVisible();

  // Seen once is seen: a reload of the session doesn't bring it back.
  await page.reload();
  await expect(page.getByRole('button', { name: /Skip recording|Show Answer|Check Answer|Reveal/i }).first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1000);
  await expect(explainer).toHaveCount(0);
});
