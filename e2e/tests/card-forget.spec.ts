import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * Leeches + "Forget this card" (shared/cards/leech.ts, docs/STUDY_SESSION.md "Leeches" / "Forget"):
 * a card missed 9 times after it was learned shows "⚠️ Missed 9×" on the answer side; the sheet says
 * how it went. ⋯ → Forget this card… shows the warning BEFORE anything happens; ↺ Forget card puts it
 * back to New (the server has the forget, the reviews stay) and Undo takes it back.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SHOTS = process.env.CARD_FORGET_SHOTS;
const DAY = 86_400_000;
const MIN = 60_000;

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
  const reveal = page.getByRole('button', { name: /Skip recording|Show Answer|Check Answer|Reveal|Show answer/i }).first();
  await reveal.waitFor({ timeout: 30000 });
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await reveal.click();
  await page.getByTestId('study-action-row').waitFor({ timeout: 15000 });
}

test('A leech shows "Missed 9×"; Forget this card warns first, resets it to New, and Undo brings it back', async ({ page, request }) => {
  test.setTimeout(120_000);
  const email = `forget-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Forget learner' } });
  const token = auth.session_token;
  await api(request, '/api/profile/study-budget', { method: 'PUT', token, data: { new_cards_per_day: 0, secondary_cards_per_day: 0 } });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'Leeches' } });
  const note = await api<{ id: string }>(request, `/api/decks/${deck.id}/notes?check=none`, { method: 'POST', token, data: { hanzi: '辛苦', pinyin: 'xīnkǔ', english: 'hard-working; tiring' } });
  const { cards } = await api<{ cards: Array<{ id: string; card_type: string }> }>(request, `/api/notes/${note.id}`, { token });
  const card = cards.find((c) => c.card_type === 'hanzi_to_meaning')!;

  // Learned (Good, Good, Good), then 9 × (Again in Review, relearned): a leech, due today.
  let t = Date.now() - 150 * DAY;
  let n = 0;
  const events: Array<{ id: string; card_id: string; rating: number; reviewed_at: string }> = [];
  const push = (rating: number, gap: number) => {
    t += gap;
    events.push({ id: `e2e-forget-${card.id}-${n++}`, card_id: card.id, rating, reviewed_at: new Date(t).toISOString() });
  };
  push(2, 0); push(2, 15 * MIN); push(2, 2 * DAY);
  for (let i = 0; i < 9; i++) { push(0, 5 * DAY); push(2, 10 * MIN); push(2, 2 * DAY); }
  await api(request, '/api/reviews', { method: 'POST', token, data: { events } });
  const seeded = await api<{ cards: Array<{ id: string; queue: number; lapses: number; next_review_at: string | null }> }>(request, `/api/notes/${note.id}`, { token });
  const leech = seeded.cards.find((c) => c.id === card.id)!;
  expect(leech.lapses).toBe(9);
  expect(Date.parse(leech.next_review_at!)).toBeLessThan(Date.now());

  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('Leeches').first()).toBeVisible({ timeout: 30000 });

  // The card's state comes from the events on the device: study until the leech card is there.
  await page.goto(`/study?deck=${deck.id}&autostart=true`);
  await revealCard(page);

  const pill = page.getByTestId('leech-pill');
  await expect(pill).toContainText('Missed 9×');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-01-leech-pill.png` });
  await pill.click();
  const sheet = page.getByTestId('leech-sheet');
  await expect(sheet).toContainText("You've missed this card 9 times after learning it.");
  await expect(page.getByTestId('leech-recent')).toContainText('✗ Again — missed');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-02-leech-sheet.png` });
  await page.getByTestId('leech-forget').click();

  // The warning comes BEFORE anything happens.
  const forget = page.getByTestId('card-forget-sheet');
  await expect(page.getByTestId('forget-warning')).toContainText('This card goes back to New: its schedule restarts from scratch');
  await expect(page.getByTestId('forget-warning')).toContainText("Can't be undone except by Undo right now.");
  await expect(page.getByTestId('forget-scope-card')).toHaveAttribute('aria-checked', 'true');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-03-forget-sheet.png` });
  await page.getByTestId('forget-confirm').click();
  await expect(forget).toHaveCount(0);
  await expect(page.getByTestId('upnext-toast')).toContainText('Card reset to New.');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-04-forgot-toast.png` });

  // The server has the forget; the reviews are kept.
  await expect.poll(async () => (await api<{ forgets: Array<{ card_id: string }> }>(request, '/api/me/card-forgets', { token })).forgets.map((f) => f.card_id), { timeout: 15000 })
    .toEqual([card.id]);
  const after = await api<{ cards: Array<{ id: string; queue: number }> }>(request, `/api/notes/${note.id}`, { token });
  expect(after.cards.find((c) => c.id === card.id)!.queue).toBe(0);

  // Undo: the forget stops counting everywhere.
  await page.getByTestId('upnext-toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await api<{ forgets: unknown[] }>(request, '/api/me/card-forgets', { token })).forgets.length, { timeout: 15000 }).toBe(0);
  const restored = await api<{ cards: Array<{ id: string; queue: number }> }>(request, `/api/notes/${note.id}`, { token });
  expect(restored.cards.find((c) => c.id === card.id)!.queue).not.toBe(0);

  if (SHOTS) {
    // The card hub with a forget in place: its controls and the marker among the reviews (screenshots only).
    await api(request, '/api/me/card-forgets', { method: 'POST', token, data: { card_ids: [card.id], source: 'other' } });
    await page.goto(`/cards/${note.id}`);
    await expect(page.getByTestId('hub-card-controls')).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.getByTestId('hub-card-controls').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/web-05-card-hub.png` });
    await page.getByTestId('history-forget').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/web-06-history.png` });
  }
});
