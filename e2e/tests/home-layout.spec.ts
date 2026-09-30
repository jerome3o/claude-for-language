import { test, expect, Page, APIRequestContext } from '@playwright/test';

/**
 * Home "Your decks" card must fit at every width: no page-level horizontal scroll, every deck row
 * inside its card, and the "n due" + queue button never pushed out by a long deck name (the
 * desktop two-column grid used to let a long name widen its column past the card edge).
 *
 * Self-contained: seeds its own user and decks through the E2E test-auth endpoint and the API.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {},
): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

const LONG_NAME = 'MH Lesson 8.3_（一）边……（一）边……(from tutor) — a very long homework deck name that keeps going';
const DECKS: [string, [string, string, string]][] = [
  [LONG_NAME, ['一边', 'yībiān', 'while']],
  ['Lesson vocab - 28 Sep (from tutor)', ['火车', 'huǒchē', 'train']],
  ['Core Homework', ['咖啡', 'kāfēi', 'coffee']],
  ['Non-urgent Homework', ['朋友', 'péngyou', 'friend']],
  ['Phone', ['手机', 'shǒujī', 'mobile phone']],
];

const WIDTHS = [412, 1024, 1440, 1980];

async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth) problems.push(`page scrolls sideways: ${doc.scrollWidth} > ${doc.clientWidth}`);
    const card = document.querySelector('section[aria-label="Your decks"]');
    if (!card) return ['no "Your decks" card'];
    const c = card.getBoundingClientRect();
    const inside = (r: DOMRect, box: DOMRect) => r.left >= box.left - 0.5 && r.right <= box.right + 0.5;
    card.querySelectorAll('.home-deck-row').forEach((row, i) => {
      const r = row.getBoundingClientRect();
      if (!inside(r, c)) problems.push(`row ${i} [${r.left}, ${r.right}] outside card [${c.left}, ${c.right}]`);
      for (const sel of ['.home-deck-due', '.home-top-btn']) {
        const el = row.querySelector(sel);
        if (el && !inside(el.getBoundingClientRect(), r)) problems.push(`row ${i} ${sel} pushed out of its row`);
      }
    });
    const next = card.querySelector('[data-testid="next-up"]');
    if (next && !inside(next.getBoundingClientRect(), c)) problems.push('next-up line outside card');
    document.querySelectorAll('[data-testid="homework-home-card"] .hw-slim').forEach((row, i) => {
      const hw = row.closest('[data-testid="homework-home-card"]')!.getBoundingClientRect();
      if (!inside(row.getBoundingClientRect(), hw)) problems.push(`homework row ${i} outside its card`);
    });
    return problems;
  });
}

test('Home deck rows fit inside the card at every width with a long deck name', async ({ page, request }) => {
  test.setTimeout(120_000);
  const email = `home-layout-${Date.now()}@test.e2e`;
  const u = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Home Layout' } });
  const token = u.session_token;
  for (const [name, [hanzi, pinyin, english]] of DECKS) {
    const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name } });
    await api(request, `/api/decks/${deck.id}/notes`, { method: 'POST', token, data: { hanzi, pinyin, english } });
  }

  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto(`/?session_token=${token}`);
  await expect(page.locator('.home-deck-row')).toHaveCount(DECKS.length, { timeout: 30_000 });
  await expect(page.locator('.home-deck-name', { hasText: 'MH Lesson 8.3' })).toHaveAttribute('title', LONG_NAME);

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(150);
    expect(await layoutProblems(page), `at ${width}px`).toEqual([]);
  }
});
