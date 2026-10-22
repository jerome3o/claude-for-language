import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * Suspend & snooze (shared/decks/holds.ts, docs/STUDY_SESSION.md "Suspend & snooze"): with ONE new
 * card a day, the first word comes up; ⋯ → Suspend… → this card only takes it out of study and the
 * freed slot brings the next word at once. Settings → "Suspended & snoozed cards" lists it; Unsuspend
 * brings it back to study. The server holds the same.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SHOTS = process.env.CARD_HOLD_SHOTS;

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

async function revealCard(page: Page) {
  const reveal = page.getByRole('button', { name: /Skip recording|Show Answer|Check Answer|Reveal/i }).first();
  await reveal.waitFor({ timeout: 30000 });
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await reveal.click();
  await page.getByTestId('study-action-row').waitFor({ timeout: 15000 });
}

test('Suspend a card from the study card: gone from study (its slot goes to the next word), back from Settings', async ({ page, request }) => {
  const email = `holds-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Hold learner' } });
  const token = auth.session_token;
  await api(request, '/api/profile/study-budget', { method: 'PUT', token, data: { new_cards_per_day: 1, secondary_cards_per_day: 0 } });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'Holds' } });
  for (const note of [
    { hanzi: '银行', pinyin: 'yínháng', english: 'bank' },
    { hanzi: '苹果', pinyin: 'píngguǒ', english: 'apple' },
  ]) {
    await api(request, `/api/decks/${deck.id}/notes?check=none`, { method: 'POST', token, data: note });
  }

  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('Holds').first()).toBeVisible({ timeout: 30000 });

  await page.goto(`/study?deck=${deck.id}&autostart=true`);
  await revealCard(page);
  const card = page.locator('.study-fullscreen');
  const first = (await card.textContent())?.includes('银行') ? '银行' : '苹果';
  const second = first === '银行' ? '苹果' : '银行';

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: /Suspend…/ }).click();
  const sheet = page.getByTestId('card-suspend-sheet');
  await expect(sheet).toContainText('Suspended cards leave study completely');
  await expect(page.getByTestId('cc-scope-card')).toHaveAttribute('aria-checked', 'true');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-01-suspend-sheet.png` });
  await page.getByTestId('cc-suspend-confirm').click();
  await expect(page.getByText('Suspended — it stays out of study until you unsuspend it.')).toBeVisible();

  // The freed new-card slot: the other word comes up straight away.
  await expect(card).toContainText(second, { timeout: 15000 });
  await expect(card).not.toContainText(first);

  // The server has the hold (sent right away while online).
  await expect.poll(async () => (await api<{ holds: Array<{ hanzi: string; kind: string }> }>(request, '/api/me/card-holds', { token })).holds.map((h) => `${h.hanzi}:${h.kind}`), { timeout: 15000 })
    .toEqual([`${first}:suspend`]);

  // Settings → Suspended & snoozed cards → Unsuspend.
  await page.goto('/settings');
  await expect(page.getByTestId('held-cards-link')).toContainText('1 suspended', { timeout: 30000 });
  await page.getByTestId('held-cards-link').click();
  await expect(page.getByTestId('held-row')).toHaveCount(1);
  await expect(page.getByTestId('held-row')).toContainText(first);
  await expect(page.getByTestId('held-row')).toContainText('⏸ Suspended');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-02-held-list.png` });
  await page.getByTestId('held-release').click();
  await expect(page.getByTestId('upnext-toast')).toContainText('Back in study.');
  await expect(page.getByTestId('held-empty')).toBeVisible();
  await expect.poll(async () => (await api<{ holds: unknown[] }>(request, '/api/me/card-holds', { token })).holds.length, { timeout: 15000 }).toBe(0);
});
