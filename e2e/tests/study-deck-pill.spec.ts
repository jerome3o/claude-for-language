import { test, expect, APIRequestContext } from '@playwright/test';
import { skipFirstCardExplainer } from './fixtures/explainer';

/**
 * The study card's 📚 deck pill (components/study/DeckPill.tsx): a long deck name is cut to one
 * line with an ellipsis; a tap shows the FULL name (with "(from tutor)") and "Open deck →"; a tap
 * on it never reveals the card (question side) nor peeks it (answer side); a tap elsewhere closes
 * it; "Open deck →" opens the deck page.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const DECK = '课堂生词 Lesson words – 12 Oct (from tutor)';

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

test.beforeEach(async ({ context }) => skipFirstCardExplainer(context));
test.use({ viewport: { width: 412, height: 915 } });

test('deck pill: truncated, a tap shows the full name without revealing the card, Open deck →', async ({ page, request }) => {
  test.setTimeout(120_000);
  const email = `deck-pill-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Deck pill learner' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: DECK } });
  await api(request, `/api/decks/${deck.id}/notes?check=none`, {
    method: 'POST',
    token,
    data: { hanzi: '打算', pinyin: 'dǎsuàn', english: 'to plan', fun_facts: '打 (dǎ) do · 算 (suàn) reckon' },
  });

  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText(DECK).first()).toBeVisible({ timeout: 30000 });
  // The session can be built before the sync has the new deck's cards ("Nothing due"): open it again then.
  await expect(async () => {
    await page.goto(`/study?deck=${deck.id}&autostart=true`);
    await expect(page.getByTestId('study-deck-pill')).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 60000 });

  const pill = page.getByTestId('study-deck-pill');
  await expect(pill).toBeVisible({ timeout: 30000 });
  await expect(pill).toHaveAttribute('aria-label', `Deck: ${DECK}`);
  // One line, cut with an ellipsis: the label is narrower than its text.
  const label = page.getByTestId('study-deck-pill-label');
  const cut = await label.evaluate((el) => ({
    overflow: el.scrollWidth > el.clientWidth,
    ellipsis: getComputedStyle(el).textOverflow,
    oneLine: el.getBoundingClientRect().height < 24,
  }));
  expect(cut).toEqual({ overflow: true, ellipsis: 'ellipsis', oneLine: true });
  // The touch target is at least 44px tall.
  expect((await pill.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // A tap shows the full name; the card stays on the question.
  await pill.click();
  await expect(page.getByTestId('study-deck-pill-name')).toHaveText(DECK);
  await expect(page.getByTestId('study-card-back')).toHaveCount(0);
  await page.getByTestId('study-deck-pill-name').click();
  await expect(page.getByTestId('study-card-back')).toHaveCount(0);
  // A tap elsewhere closes it.
  await page.locator('.study-topbar').click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('study-deck-pill-full')).toHaveCount(0);

  // On the answer side, a tap on the pill never peeks the question.
  await page.getByRole('button', { name: /Skip recording|Show Answer|Check Answer|Reveal/i }).first().click();
  await expect(page.getByTestId('study-card-back')).toBeVisible();
  await pill.click();
  await expect(page.getByTestId('study-deck-pill-full')).toBeVisible();
  await expect(page.getByTestId('study-card-back')).toBeVisible();
  await expect(page.getByTestId('study-peek-front')).toHaveCount(0);

  // Open deck → the deck page.
  await page.getByTestId('study-deck-pill-open').click();
  await expect(page).toHaveURL(new RegExp(`/decks/${deck.id}$`));
});
