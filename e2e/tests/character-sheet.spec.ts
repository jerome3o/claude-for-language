import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * The character sheet (docs/STUDY_SESSION.md "Character sheet"): tap a character on the card
 * back → card-independent dictionary data from GET /api/chars (no AI call), and "Words with 行"
 * marked from the learner's own cards — ✓ Known for a mature card, 📚 In your decks for one
 * still being learned — then add a word they don't have through the add-card sheet.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const DAY = 86_400_000;

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

test('card back → tap 行 → the sheet shows its words with Known / In your decks → add one', async ({ page, request }) => {
  const email = `chars-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Char sheet' } });
  const token = auth.session_token;

  // The dictionary endpoint itself: card-independent, from the static data.
  const xing = await api<{ record: { char: string; readings: Array<{ pinyin: string }>; words: Array<{ hanzi: string }> } }>(
    request, `/api/chars/${encodeURIComponent('行')}`, { token },
  );
  expect(xing.record.readings.map((r) => r.pinyin)).toEqual(expect.arrayContaining(['xíng', 'háng']));
  expect(xing.record.words.map((w) => w.hanzi)).toEqual(expect.arrayContaining(['进行', '银行', '行业']));

  const study = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: '银行 deck' } });
  await api(request, `/api/decks/${study.id}/notes`, { method: 'POST', token, data: { hanzi: '银行', pinyin: 'yínháng', english: 'bank' } });
  const other = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'Older words' } });
  const known = await api<{ id: string }>(request, `/api/decks/${other.id}/notes`, { method: 'POST', token, data: { hanzi: '进行', pinyin: 'jìnxíng', english: 'to carry out' } });
  // 进行 is mature: every card reviewed Easy three times over the last half year.
  const { cards } = await api<{ cards: Array<{ id: string }> }>(request, `/api/notes/${known.id}`, { token });
  const events = cards.flatMap((c) => [200, 150, 40].map((daysAgo, i) => ({
    id: `e2e-${c.id}-${i}`, card_id: c.id, rating: 3, reviewed_at: new Date(Date.now() - daysAgo * DAY).toISOString(),
  })));
  await api(request, '/api/reviews', { method: 'POST', token, data: { events } });

  await page.goto(`/decks?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await expect(page.getByText('Older words')).toBeVisible({ timeout: 30000 });
  await page.goto(`/study?deck=${study.id}&autostart=true`);
  const reveal = page.getByRole('button', { name: /Skip recording|Show Answer|Check Answer|Reveal/i }).first();
  await reveal.waitFor({ timeout: 30000 });
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  const typed = page.locator('input[type="text"], textarea').first();
  if (await typed.isVisible().catch(() => false)) await typed.fill('银行');
  await reveal.click();
  await page.getByTestId('study-action-row').waitFor({ timeout: 15000 });

  // Tap 行 on the back.
  await page.locator('.diff-char-clickable, .hanzi-char-clickable').filter({ hasText: '行' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'The character 行' });
  await expect(sheet).toContainText('xíng');
  await expect(sheet).toContainText('Words with 行');

  const rows = sheet.getByTestId('char-word-row');
  // The card's own word comes first, highlighted, and is "in your decks" (new card).
  await expect(rows.first()).toContainText('银行');
  await expect(rows.first()).toHaveAttribute('data-status', 'in_decks');
  await expect(rows.first()).toContainText('📚 In your decks');
  const jinxing = rows.filter({ hasText: '进行' });
  await expect(jinxing).toHaveAttribute('data-status', 'known');
  await expect(jinxing).toContainText('✓ Known');
  const hangye = rows.filter({ hasText: '行业' });
  await expect(hangye).toHaveAttribute('data-status', 'none');

  // Add 行业 through the add-card sheet (top deck preselected).
  await hangye.click();
  const add = page.getByRole('dialog', { name: 'Add 行业 as a card' });
  await expect(add).toBeVisible();
  await add.getByRole('button', { name: 'Add to deck' }).click();
  await expect(add).toBeHidden({ timeout: 10000 });
  await expect(hangye).toHaveAttribute('data-status', 'in_decks', { timeout: 10000 });

  // A word they already have offers ⚡ Study it today instead.
  await jinxing.click();
  const have = page.getByRole('dialog', { name: 'Add 进行 as a card' });
  await expect(have.getByTestId('already-have')).toContainText('You already have 进行');
  await expect(have.getByRole('button', { name: '⚡ Study it today' })).toBeVisible();
  await expect(have.getByRole('button', { name: 'Open card →' })).toBeVisible();
});
