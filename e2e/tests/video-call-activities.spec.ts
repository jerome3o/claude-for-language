import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * In-call activities (docs/VIDEO_CALLS.md "In-call activities"): two people in a
 * call play a shared activity — the room runs the state machine, each person
 * sees their own role's view, and a reload comes back to the same state.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const LAUNCH = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};

test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'], ...LAUNCH },
  permissions: ['camera', 'microphone'],
});

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()}`);
  return (await res.json()) as T;
}

async function openAs(browser: Browser, token: string): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1280, height: 800 } });
  // Newer Chrome (Minghui's and Jerome's, Oct 2026) returns a Promise from the scroll methods; an
  // effect written `() => el.scrollIntoView()` then hands React a Promise as its cleanup and the call
  // crashed ("n is not a function"). Emulate it so every activity here runs under that behaviour.
  await ctx.addInitScript(() => {
    for (const proto of [Element.prototype, window] as unknown as Record<string, (...a: unknown[]) => unknown>[]) {
      for (const name of ['scrollIntoView', 'scrollTo', 'scrollBy', 'scroll']) {
        const orig = proto[name];
        if (typeof orig !== 'function') continue;
        proto[name] = function (this: unknown, ...a: unknown[]) {
          orig.apply(this, a);
          return Promise.resolve();
        };
      }
    }
  });
  const page = await ctx.newPage();
  await page.goto(`/?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  return page;
}

async function joinCall(page: Page, callId: string) {
  await page.goto(`/calls/${callId}`);
  await expect(page.getByTestId('join-call')).toBeEnabled({ timeout: 20000 });
  await page.getByTestId('record-toggle').uncheck();
  await page.getByTestId('join-call').click();
  await page.getByTestId('call-live').waitFor({ timeout: 20000 });
}

async function startActivity(page: Page, id: string) {
  await page.getByLabel('More').click();
  await page.getByTestId('menu-activities').click();
  await page.locator(`[data-testid="activity-picker-row"][data-activity="${id}"]`).click();
}

async function setup(browser: Browser, request: APIRequestContext) {
  const seed = async (tag: string, name: string) => {
    const email = `calla-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
    const r = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
    return { email, token: r.session_token };
  };
  const tutor = await seed('tutor', '王老师');
  const student = await seed('student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
  const { call } = await api<{ call: { id: string } }>(request, '/api/calls', { method: 'POST', token: tutor.token, data: { relationship_id: rel.data.id } });
  const tp = await openAs(browser, tutor.token);
  const sp = await openAs(browser, student.token);
  await joinCall(tp, call.id);
  await joinCall(sp, call.id);
  return { tutor, student, call, tp, sp };
}

test('dictation: the tutor starts a word, the student types it live, the tutor reveals and marks; a reload keeps the state', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const { tutor, call, tp, sp } = await setup(browser, request);

  // The STUDENT opens it from the menu; the tutor is the reader (host) anyway.
  await startActivity(sp, 'dictation-everyday-1');
  for (const p of [tp, sp]) {
    await expect(p.getByTestId('activity-tile')).toBeVisible({ timeout: 15000 });
    await expect(p.getByTestId('call-tiles')).toHaveAttribute('data-stage', /activity/);
    await expect(p.getByTestId('activity-progress')).toHaveText('1 / 8');
  }
  await expect(tp.getByTestId('activity-role')).toHaveText('Reader');
  await expect(sp.getByTestId('activity-role')).toHaveText('Writer');
  await expect(tp.getByTestId('activity-role-badge')).toContainText('You read out');
  await expect(sp.getByTestId('activity-role-badge')).toContainText('You write');
  // Only the tutor sees the word and the controls.
  await expect(tp.getByTestId('dictation-word')).toHaveText('你好');
  await expect(sp.getByTestId('dictation-word')).toHaveCount(0);
  // The student's ⋯ only ends it; skip / reset / swap are the tutor's.
  await sp.getByTestId('activity-menu').click();
  await expect(sp.getByTestId('activity-finish')).toBeVisible();
  await expect(sp.getByTestId('activity-skip')).toHaveCount(0);
  await sp.getByTestId('activity-menu').click();

  await tp.getByTestId('dictation-start').click();
  const input = sp.getByTestId('dictation-input');
  await expect(input).toBeVisible({ timeout: 10000 });
  await input.pressSequentially('你号', { delay: 60 });
  // The tutor sees it being typed.
  await expect(tp.getByTestId('dictation-live')).toContainText('你号', { timeout: 10000 });

  // The student reloads mid-round: the room gives the same session back.
  await sp.reload();
  await expect(sp.getByTestId('join-call')).toBeEnabled({ timeout: 20000 });
  await sp.getByTestId('record-toggle').uncheck();
  await sp.getByTestId('join-call').click();
  await expect(sp.getByTestId('activity-tile')).toBeVisible({ timeout: 15000 });
  await expect(sp.getByTestId('dictation-input')).toHaveValue('你号');

  await sp.getByTestId('dictation-submit').click();
  await expect(tp.getByTestId('dictation-live')).toContainText('wrote', { timeout: 10000 });
  await tp.getByTestId('dictation-reveal').click();
  for (const p of [tp, sp]) await expect(p.getByTestId('activity-verdict')).toHaveText('✗ Not quite', { timeout: 10000 });
  await expect(sp.getByTestId('dictation-diff')).toHaveAttribute('aria-label', 'Written: 你号');
  // The tutor overrides the mark (close enough) — the student sees it too.
  await tp.getByTestId('mark-right').click();
  await expect(sp.getByTestId('activity-verdict')).toHaveText('✓ Right', { timeout: 10000 });
  await expect(sp.getByTestId('activity-score')).toHaveText('✓ 1/1');
  await tp.getByTestId('activity-next').click();
  await expect(sp.getByTestId('activity-progress')).toHaveText('2 / 8', { timeout: 10000 });

  // End it: the summary on both; closing keeps it with the lesson.
  await tp.getByTestId('activity-menu').click();
  await tp.getByTestId('activity-finish').click();
  for (const p of [tp, sp]) await expect(p.getByTestId('activity-done-score')).toHaveText('1 / 1 right', { timeout: 10000 });
  await sp.getByTestId('activity-done-close').click();
  for (const p of [tp, sp]) await expect(p.getByTestId('activity-tile')).toHaveCount(0, { timeout: 10000 });
  const detail = await api<{ activities: { activity_id: string; summary: { correct: number; lines: string[] } }[] }>(request, `/api/calls/${call.id}`, { token: tutor.token });
  expect(detail.activities).toHaveLength(1);
  expect(detail.activities[0]).toMatchObject({ activity_id: 'dictation-everyday-1', summary: { correct: 1 } });
  expect(detail.activities[0].summary.lines[0]).toBe('你好 (nǐ hǎo, hello) — wrote 你号 ✓');
});

test('describe & guess and sentence building: each sees their own side; both build one sentence', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const { tp, sp } = await setup(browser, request);

  // ---- Describe & guess: the student describes, the tutor guesses.
  await startActivity(tp, 'describe-food-1');
  await expect(sp.getByTestId('describe-target')).toHaveText('苹果', { timeout: 15000 });
  await expect(tp.getByTestId('describe-target')).toHaveCount(0);
  await expect(tp.getByTestId('describe-option')).toHaveCount(8);
  await expect(sp.getByTestId('describe-option')).toHaveCount(0); // the describer never sees the choices
  await tp.getByTestId('describe-option').filter({ hasText: '苹果' }).click();
  for (const p of [tp, sp]) await expect(p.getByTestId('activity-verdict')).toHaveText('✓ 王老师 got it!', { timeout: 10000 });
  await expect(sp.getByTestId('describe-option')).toHaveCount(0);
  // The describer moves on (whose turn it is), not only the host.
  await sp.getByTestId('activity-next').click();
  await expect(sp.getByTestId('describe-target')).toHaveText('香蕉', { timeout: 10000 });
  // Swap roles: now the tutor describes — both are told.
  await tp.getByTestId('activity-menu').click();
  await tp.getByTestId('activity-swap').click();
  await expect(tp.getByTestId('describe-target')).toHaveText('香蕉', { timeout: 10000 });
  await expect(sp.getByTestId('describe-option')).toHaveCount(8);
  await expect(sp.getByTestId('activity-role-badge')).toContainText('You guess');
  await expect(sp.getByTestId('activity-swap-note')).toHaveText('⇄ Roles swapped — now you guess');
  await expect(tp.getByTestId('activity-swap-note')).toHaveText('⇄ Roles swapped — now you describe');

  // ---- Starting another replaces it.
  await startActivity(sp, 'build-sentences-1');
  await expect(tp.getByTestId('activity-tile')).toHaveAttribute('data-kind', 'build', { timeout: 15000 });
  const want = ['我', '把', '书', '放在', '桌子上'];
  for (const [i, w] of want.entries()) {
    const p = i % 2 ? sp : tp; // taking turns
    await p.getByTestId('build-tile').filter({ hasText: new RegExp(`^${w}$`) }).click();
    await expect((i % 2 ? tp : sp).getByTestId('build-placed')).toHaveCount(i + 1, { timeout: 10000 });
  }
  await expect(sp.getByTestId('build-answer')).toHaveText('我把书放在桌子上');
  // Building is for both: either may reveal.
  await expect(sp.getByTestId('build-reveal')).toBeVisible();
  await tp.getByTestId('build-reveal').click();
  for (const p of [tp, sp]) await expect(p.getByTestId('activity-verdict')).toHaveText('✓ That’s it!', { timeout: 10000 });
  await sp.getByTestId('build-said').click();
  await expect(tp.getByText('✓ Jerome')).toBeVisible({ timeout: 10000 });
});

test('role-play: each new line scrolls into view; starting another activity after it keeps the call up', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { tp, sp } = await setup(browser, request);
  await startActivity(tp, 'roleplay-directions-1');
  await expect(sp.getByTestId('activity-tile')).toHaveAttribute('data-kind', 'roleplay', { timeout: 15000 });
  // The tourist (student) reads line 1, the passer-by (tutor) line 2.
  await sp.getByTestId('roleplay-done').click();
  await expect(tp.getByTestId('roleplay-turn')).toHaveText('Your line — read it aloud', { timeout: 10000 });
  await tp.getByTestId('roleplay-done').click();
  await expect(sp.getByTestId('roleplay-turn')).toHaveText('Your line — read it aloud', { timeout: 10000 });
  // A different activity replaces the role-play (its view unmounts).
  await startActivity(tp, 'describe-food-1');
  for (const p of [tp, sp]) {
    await expect(p.getByTestId('activity-tile')).toHaveAttribute('data-kind', 'describe', { timeout: 15000 });
    await expect(p.getByTestId('call-live')).toBeVisible();
    await expect(p.getByText("Couldn't open the call")).toHaveCount(0);
    await expect(p.getByTestId('tile-error')).toHaveCount(0);
  }
});

test('describe & guess started by the STUDENT: only the guesser picks, the pick is theirs, and a word they needed becomes a card', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const { student, tp, sp } = await setup(browser, request);
  await api(request, '/api/decks', { method: 'POST', token: student.token, data: { name: '课堂生词' } });

  await startActivity(sp, 'describe-food-1');
  for (const p of [tp, sp]) await expect(p.getByTestId('activity-tile')).toHaveAttribute('data-kind', 'describe', { timeout: 15000 });
  // The tutor still guesses (her role in this activity) and hosts; the student describes.
  await expect(sp.getByTestId('activity-role-badge')).toContainText('You describe');
  await expect(tp.getByTestId('activity-role-badge')).toContainText('You guess');
  await expect(sp.getByTestId('describe-describer')).toBeVisible();
  await expect(sp.getByTestId('describe-option')).toHaveCount(0);
  await expect(tp.getByTestId('describe-option')).toHaveCount(8);
  // Her wrong pick is named as hers on both screens.
  const wrong = tp.getByTestId('describe-option').filter({ hasNotText: '苹果' }).first();
  const wrongText = (await wrong.textContent())!.trim();
  await wrong.click();
  for (const p of [tp, sp]) await expect(p.getByTestId('activity-verdict')).toHaveText(`✗ 王老师 picked ${wrongText}`, { timeout: 10000 });

  // Words you needed: the answer first, then the hints.
  const rows = sp.getByTestId('needed-word');
  await expect(rows.first()).toContainText('苹果');
  await expect(rows.first()).toHaveAttribute('data-kind', 'target');
  await expect(sp.getByTestId('needed-word').filter({ hasText: '水果' })).toContainText('shuǐguǒ');
  await sp.getByTestId('needed-word').filter({ hasText: '水果' }).getByTestId('needed-word-add').click();
  await expect(sp.getByRole('dialog', { name: 'Add 水果 as a card' })).toBeVisible();
  await expect(sp.getByRole('radio', { name: '课堂生词' })).toHaveAttribute('aria-checked', 'true');
  await sp.getByRole('button', { name: 'Add to deck' }).click();
  await expect(sp.getByTestId('needed-word').filter({ hasText: '水果' }).getByTestId('needed-word-add')).toHaveText('✓ Added', { timeout: 10000 });
  const decks = await api<{ id: string; name: string }[] | { decks: { id: string; name: string }[] }>(request, '/api/decks', { token: student.token });
  const list = Array.isArray(decks) ? decks : decks.decks;
  const deck = await api<{ notes: { hanzi: string }[] }>(request, `/api/decks/${list.find((d) => d.name === '课堂生词')!.id}`, { token: student.token });
  expect(deck.notes.map((n) => n.hanzi)).toContain('水果');

  // The student ends it: the summary lists the words again, with who picked what.
  await sp.getByTestId('activity-menu').click();
  await sp.getByTestId('activity-finish').click();
  for (const p of [tp, sp]) await expect(p.getByTestId('activity-done')).toBeVisible({ timeout: 10000 });
  await expect(sp.getByTestId('activity-done')).toContainText(`王老师 picked ${wrongText}`);
  await expect(sp.getByTestId('activity-done').getByTestId('needed-word').first()).toContainText('苹果');
});
