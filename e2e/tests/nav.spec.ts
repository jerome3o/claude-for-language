import { test, expect, Page, APIRequestContext } from '@playwright/test';

/**
 * Bottom tab bar + role-aware navigation + landing preference.
 *
 * Self-contained: seeds its own users through the E2E test-auth endpoint
 * (E2E_TEST_MODE=true) and the public API, so it does not depend on the
 * shared auth fixture. Defaults match e2e/playwright.config.ts; override with
 * E2E_API_URL / E2E_BASE_URL when running against other ports.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PUT'; token?: string; data?: unknown } = {},
): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) {
    throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function seedUser(request: APIRequestContext, tag: string): Promise<SeededUser> {
  const email = `nav-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', {
    method: 'POST',
    data: { email, name: `Nav ${tag}` },
  });
  return { id: r.user.id, email, token: r.session_token };
}

const WORDS: [string, string, string][] = [
  ['你好', 'nǐ hǎo', 'hello'], ['谢谢', 'xièxie', 'thank you'], ['再见', 'zàijiàn', 'goodbye'],
  ['咖啡', 'kāfēi', 'coffee'], ['火车', 'huǒchē', 'train'], ['朋友', 'péngyou', 'friend'],
];

async function seedDeck(request: APIRequestContext, u: SeededUser, name: string, words = 0) {
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: u.token, data: { name } });
  for (const [hanzi, pinyin, english] of WORDS.slice(0, words)) {
    await api(request, `/api/decks/${deck.id}/notes`, { method: 'POST', token: u.token, data: { hanzi, pinyin, english } });
  }
  return deck;
}

/** tutor invites student as their tutor; the student accepts. */
async function pair(request: APIRequestContext, tutor: SeededUser, student: SeededUser) {
  const r = await api<{ type: string; data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  await api(request, `/api/relationships/${r.data.id}/accept`, { method: 'POST', token: student.token });
}

async function login(page: Page, u: SeededUser, path = '/') {
  const sep = path.includes('?') ? '&' : '?';
  await page.goto(`${path}${sep}session_token=${u.token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
}

const bar = (page: Page) => page.getByTestId('tab-bar');

/** The bar's bottom edge sits exactly on the bottom of the viewport. */
async function expectBarAnchored(page: Page, label: string) {
  await expect(bar(page), label).toBeVisible();
  const m = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="tab-bar"]')!;
    const r = el.getBoundingClientRect();
    return {
      bottom: r.bottom,
      top: r.top,
      innerHeight: window.innerHeight,
      docWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      pos: getComputedStyle(el).position,
    };
  });
  expect(Math.abs(m.bottom - m.innerHeight), `${label}: bar bottom ${m.bottom} vs innerHeight ${m.innerHeight}`).toBeLessThanOrEqual(1);
  expect(m.pos, label).toBe('fixed');
  expect(m.innerHeight - m.top, `${label}: bar height`).toBeGreaterThanOrEqual(44);
  expect(m.docWidth, `${label}: no horizontal scroll`).toBeLessThanOrEqual(m.innerWidth);
}

/** Every tab is at least 44px tall and its label at least 12px. */
async function expectTargets(page: Page) {
  const items = bar(page).locator('.tab-bar-item');
  const n = await items.count();
  expect(n).toBeGreaterThanOrEqual(4);
  for (let i = 0; i < n; i++) {
    const box = await items.nth(i).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const fs = await items.nth(i).locator('.tab-bar-label').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fs).toBeGreaterThanOrEqual(12);
  }
}

/** Nothing in the document ends below the top of the bar once scrolled to the bottom. */
async function expectNothingHidden(page: Page, label: string) {
  // Let per-deck stats etc. arrive first: they change the page height.
  await page.waitForLoadState('networkidle');
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(150);
  }
  const m = await page.evaluate(() => {
    const barEl = document.querySelector('[data-testid="tab-bar"]')!;
    const barTop = barEl.getBoundingClientRect().top;
    // deepest visible content bottom, ignoring fixed overlays
    let maxBottom = 0;
    let offender = '';
    const root = document.getElementById('root')!;
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
      if (barEl.contains(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed') continue;
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom > maxBottom) { maxBottom = r.bottom; offender = el.tagName + '.' + el.className; }
    }
    return { barTop, maxBottom, offender, innerHeight: window.innerHeight,
      scrolledToEnd: Math.abs(window.innerHeight + window.scrollY - document.documentElement.scrollHeight) <= 1 };
  });
  expect(m.scrolledToEnd, `${label}: scrolled to the end`).toBe(true);
  expect(m.maxBottom, `${label}: content (${m.offender}) ends below the bar top`).toBeLessThanOrEqual(m.barTop + 0.5);
}

const VIEWPORTS = [
  { name: 'phone portrait', width: 412, height: 915 },
  { name: 'phone with keyboard', width: 412, height: 700 },
  { name: 'unfolded', width: 840, height: 1000 },
  { name: 'desktop', width: 1280, height: 800 },
];

test.describe('bottom tab bar', () => {
  let student: SeededUser;

  test.beforeAll(async ({ request }) => {
    student = await seedUser(request, 'student');
    // A long page: 30 decks
    for (let i = 1; i <= 30; i++) {
      await seedDeck(request, student, `第${i}课 词汇`, i === 1 ? 3 : 0);
    }
  });

  for (const vp of VIEWPORTS) {
    test(`stays anchored at ${vp.width}×${vp.height} (${vp.name})`, async ({ page, request }) => {
      void request;
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await login(page, student, '/');

      await expectBarAnchored(page, 'after load');
      await expectTargets(page);

      // Long page: the deck list with 30 decks
      await page.getByTestId('tab-bar').locator('[data-tab="decks"]').click();
      await expect(page).toHaveURL(/\/decks$/);
      await expect(page.getByTestId('deck-card').first()).toBeVisible();
      await expect(page.getByTestId('deck-card')).toHaveCount(30);
      await expectBarAnchored(page, 'decks page');
      await expectNothingHidden(page, 'decks page');
      await expectBarAnchored(page, 'after scrolling to the bottom');

      // Viewport resize (keyboard opening/closing, toolbar collapsing)
      await page.setViewportSize({ width: vp.width, height: Math.max(400, vp.height - 300) });
      await page.waitForTimeout(100);
      await expectBarAnchored(page, 'after shrinking the viewport');
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(100);
      await expectBarAnchored(page, 'after restoring the viewport');

      // Focused input (the search field) stays above the bar
      const search = page.getByTestId('decks-search');
      await search.focus();
      const sb = await search.boundingBox();
      const bb = await bar(page).boundingBox();
      expect(sb!.y + sb!.height).toBeLessThanOrEqual(bb!.y);

      // Navigating between tabs
      for (const tab of ['progress', 'more', 'tutor', 'study']) {
        await bar(page).locator(`[data-tab="${tab}"]`).click();
        await page.waitForLoadState('networkidle');
        await expect(bar(page).locator(`[data-tab="${tab}"]`)).toHaveAttribute('aria-current', 'page');
        await expectBarAnchored(page, `on tab ${tab}`);
        await expectNothingHidden(page, `on tab ${tab}`);
      }
    });
  }

  test('is absent on /study (immersive) and back on the next page', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    // Study is offline-first: let the first sync fill IndexedDB (the home
    // button shows the counts once it has), then start a session.
    // (/study without autostart bounces home; a running session is the immersive page.)
    await login(page, student, '/');
    await expect(page.getByRole('button', { name: /Study today's cards/ })).toBeVisible({ timeout: 30000 });
    await page.goto(`/study?autostart=true&session_token=${student.token}`);
    await expect(page.locator('.study-page-fullscreen')).toBeVisible({ timeout: 30000 });
    await expect(page).toHaveURL(/\/study/);
    await expect(bar(page)).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveClass(/has-tab-bar/);

    await page.goto(`/more?session_token=${student.token}`);
    await expectBarAnchored(page, 'more page after study');
    await expect(page.locator('html')).toHaveClass(/has-tab-bar/);
  });

  test('hides itself when the visual viewport shrinks under a fixed layout viewport (iOS keyboard)', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await login(page, student, '/decks');
    await expectBarAnchored(page, 'before');
    // Simulate iOS: the layout viewport keeps its height while the visual
    // viewport loses 300px to the keyboard.
    await page.evaluate(() => {
      const vv = window.visualViewport!;
      Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - 300 });
      vv.dispatchEvent(new Event('resize'));
    });
    await expect(page.locator('html')).toHaveClass(/tab-bar-keyboard/);
    await page.evaluate(() => {
      const vv = window.visualViewport!;
      Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight });
      vv.dispatchEvent(new Event('resize'));
    });
    await expect(page.locator('html')).not.toHaveClass(/tab-bar-keyboard/);
    await page.waitForTimeout(400); // the bar slides back in (0.15s transition)
    await expectBarAnchored(page, 'after keyboard closes');
  });
});

test.describe('role-aware tabs and More page', () => {
  test('student account: Study · Decks · Tutor · Progress · More', async ({ page, request }) => {
    const student = await seedUser(request, 'student2');
    const tutor = await seedUser(request, 'tutor2');
    await pair(request, tutor, student);
    await seedDeck(request, student, '课本', 3);

    await page.setViewportSize({ width: 412, height: 915 });
    await login(page, student, '/');
    await expect(bar(page).locator('.tab-bar-label')).toHaveText(['Study', 'Decks', 'Tutor', 'Progress', 'More']);

    await page.goto(`/more?session_token=${student.token}`);
    await expect(page.getByRole('heading', { name: 'More' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Lesson Notes/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Readers/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Lesson Library/ })).toHaveCount(0);
    // Advanced is collapsed by default
    await expect(page.getByRole('link', { name: /Duplicate Finder/ })).toHaveCount(0);
    await page.getByRole('button', { name: /Advanced/ }).click();
    await expect(page.getByRole('link', { name: /Duplicate Finder/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Full Sync/ })).toBeVisible();

    // Settings: Bio + Offline audio present for a student; Advanced collapsed
    await page.goto(`/settings?session_token=${student.token}`);
    await expect(page.getByTestId('personal-bio')).toBeVisible();
    await expect(page.getByTestId('offline-audio')).toBeVisible();
    await expect(page.getByTestId('start-on')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Audio Quality' })).toHaveCount(0);
    await page.getByTestId('settings-advanced-toggle').click();
    await expect(page.getByRole('heading', { name: 'Audio Quality' })).toBeVisible();
  });

  test('tutor-only account: Students · Decks · Study · More, no study extras', async ({ page, request }) => {
    const student = await seedUser(request, 'student3');
    const tutor = await seedUser(request, 'tutor3');
    await pair(request, tutor, student);

    await page.setViewportSize({ width: 412, height: 915 });
    // Explicit landing so we can look at the tabs on the study home first
    await api(request, '/api/profile/landing-page', { method: 'PUT', token: tutor.token, data: { landing_page: 'study' } });
    await login(page, tutor, '/');
    await expect(bar(page).locator('.tab-bar-label')).toHaveText(['Students', 'Decks', 'Study', 'More']);

    await page.goto(`/more?session_token=${tutor.token}`);
    await expect(page.getByRole('link', { name: /Lesson Library/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Lesson Notes/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Readers/ })).toHaveCount(0);

    await page.goto(`/settings?session_token=${tutor.token}`);
    await expect(page.getByTestId('start-on')).toBeVisible();
    await expect(page.getByTestId('personal-bio')).toHaveCount(0);
    await expect(page.getByTestId('offline-audio')).toHaveCount(0);
  });

  test('tutor who also studies keeps Progress', async ({ page, request }) => {
    const student = await seedUser(request, 'student4');
    const tutor = await seedUser(request, 'tutor4');
    await pair(request, tutor, student);
    await seedDeck(request, tutor, '我的词汇', 3);

    await page.setViewportSize({ width: 412, height: 915 });
    await login(page, tutor, '/');
    await expect(bar(page).locator('.tab-bar-label')).toHaveText(['Students', 'Decks', 'Study', 'Progress', 'More']);
  });
});

test.describe('landing page', () => {
  test('a student lands on Study; /search redirects into the Decks search', async ({ page, request }) => {
    const student = await seedUser(request, 'landing-student');
    await seedDeck(request, student, '课本', 3);
    await login(page, student, '/');
    await expect(page).toHaveURL(/\/$/);
    await expect(bar(page).locator('[data-tab="study"]')).toHaveAttribute('aria-current', 'page');

    await page.goto(`/search?q=你好&session_token=${student.token}`);
    await expect(page).toHaveURL(/\/decks\?q=/);
    await expect(page.getByTestId('decks-search')).toHaveValue('你好');
    await expect(page.locator('.search-result-hanzi').first()).toHaveText('你好');
  });

  test('automatic: a tutor with students and nothing due lands on Students', async ({ page, request }) => {
    const student = await seedUser(request, 'landing-s2');
    const tutor = await seedUser(request, 'landing-t2');
    await pair(request, tutor, student);
    await login(page, tutor, '/');
    await expect(page).toHaveURL(/\/connections$/);
    await expect(bar(page).locator('[data-tab="students"]')).toHaveAttribute('aria-current', 'page');
    // …but the Study tab still opens the study home (no redirect loop)
    await bar(page).locator('[data-tab="study"]').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(bar(page).locator('[data-tab="study"]')).toHaveAttribute('aria-current', 'page');
  });

  test('automatic: a tutor with cards due lands on Study', async ({ page, request }) => {
    const student = await seedUser(request, 'landing-s3');
    const tutor = await seedUser(request, 'landing-t3');
    await pair(request, tutor, student);
    await seedDeck(request, tutor, '我的词汇', 3);
    await login(page, tutor, '/');
    await page.waitForTimeout(1500); // give the counts time to load — must NOT redirect
    await expect(page).toHaveURL(/\/$/);
  });

  test('explicit preference wins: Decks', async ({ page, request }) => {
    const student = await seedUser(request, 'landing-s4');
    await seedDeck(request, student, '课本', 3);
    await api(request, '/api/profile/landing-page', { method: 'PUT', token: student.token, data: { landing_page: 'decks' } });
    await login(page, student, '/');
    await expect(page).toHaveURL(/\/decks$/);
    await expect(bar(page).locator('[data-tab="decks"]')).toHaveAttribute('aria-current', 'page');

    // Settings shows the choice and it round-trips through /api/auth/me
    await page.goto(`/settings?session_token=${student.token}`);
    await expect(page.getByTestId('start-on').getByRole('radio', { name: 'Decks' })).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('start-on').getByRole('radio', { name: 'Study' }).click();
    await expect(page.getByTestId('start-on').getByRole('radio', { name: 'Study' })).toHaveAttribute('aria-checked', 'true');
    const me = await api<{ landing_page: string | null }>(request, '/api/auth/me', { token: student.token });
    expect(me.landing_page).toBe('study');
  });

  test('explicit preference wins: Students, even with cards due', async ({ page, request }) => {
    const student = await seedUser(request, 'landing-s5');
    const tutor = await seedUser(request, 'landing-t5');
    await pair(request, tutor, student);
    await seedDeck(request, tutor, '我的词汇', 3);
    await api(request, '/api/profile/landing-page', { method: 'PUT', token: tutor.token, data: { landing_page: 'students' } });
    await login(page, tutor, '/');
    await expect(page).toHaveURL(/\/connections$/);
  });
});
