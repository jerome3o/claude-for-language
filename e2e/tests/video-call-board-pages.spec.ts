import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * Board pages (shared/calls/pages.ts): the call's text board keeps its content
 * per tutor relationship as numbered pages. Two browsers in one call: a new
 * page, "Follow", "Bring <name> here", rename, delete; after the call the
 * review page shows the call's pages, the Lesson board shows every page (also
 * offline), and a second call the same day continues the page last written.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const VIEWPORT = { width: 1280, height: 820 };

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  },
  permissions: ['camera', 'microphone'],
  viewport: VIEWPORT,
});

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function seedUser(request: APIRequestContext, tag: string, name: string): Promise<SeededUser> {
  const email = `pages-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

async function openAs(browser: Browser, token: string): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: VIEWPORT });
  const page = await ctx.newPage();
  await page.goto(`/?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  return page;
}

async function join(page: Page, callId: string) {
  await page.goto(`/calls/${callId}`);
  const button = page.getByTestId('join-call');
  await expect(button).toBeEnabled({ timeout: 20000 });
  await button.click();
  await page.locator('[data-testid="call-live"], [data-testid="call-waiting"]').first().waitFor({ timeout: 20000 });
}

test('board pages: a new page, follow, bring here, rename, delete — then the review page, the Lesson board and the next call', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const tutor = await seedUser(request, 'tutor', '王老师');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  const relId = rel.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });

  const { call } = await api<{ call: { id: string } }>(request, '/api/calls', { method: 'POST', token: tutor.token, data: { relationship_id: relId } });
  const tp = await openAs(browser, tutor.token);
  const sp = await openAs(browser, student.token);
  await join(tp, call.id);
  await join(sp, call.id);

  await tp.getByTestId('open-board').click();
  // Round 5: the tutor opening the board shows it to the student (no click — a click would close it again).
  await expect(sp.getByTestId('call-tiles')).toHaveAttribute('data-stage', /text/, { timeout: 10000 });
  const tBoard = tp.getByTestId('text-board');
  const sBoard = sp.getByTestId('text-board');
  await tBoard.click();
  await tp.keyboard.type('第一课 把字句');
  await expect(sBoard).toHaveValue('第一课 把字句', { timeout: 10000 });
  const page1 = (await tBoard.getAttribute('data-page'))!;
  expect(page1).toBeTruthy();
  await expect(tp.getByTestId('board-page-thumb')).toHaveCount(1);

  // ---- The tutor starts a new page while the student looks at the camera (round 5: a student ON the
  // shown board follows her page turns by itself); back on the board they are told where she is and follow her.
  await sp.getByTestId('open-board').click();
  await expect(sp.getByTestId('call-tiles')).not.toHaveAttribute('data-stage', /text/);
  await tp.getByTestId('board-page-new').click();
  await expect(tBoard).not.toHaveAttribute('data-page', page1, { timeout: 10000 });
  await expect(tBoard).toHaveValue('');
  const page2 = (await tBoard.getAttribute('data-page'))!;
  await sp.getByTestId('open-board').click();
  await expect(sp.getByTestId('board-page-thumb')).toHaveCount(2, { timeout: 10000 });
  await expect(sBoard).toHaveAttribute('data-page', page1);
  await expect(sp.getByTestId('board-follow-bar')).toContainText('王老师 is on page 2', { timeout: 10000 });
  await sp.getByTestId('board-follow').click();
  await expect(sBoard).toHaveAttribute('data-page', page2, { timeout: 10000 });
  await expect(sp.getByTestId('board-follow-bar')).toContainText('Following 王老师');
  await tBoard.click();
  await tp.keyboard.type('第二页');
  await expect(sBoard).toHaveValue('第二页', { timeout: 10000 });

  // Back to page 1: the follower goes too.
  await tp.getByTestId('board-page-thumb').first().click();
  await expect(tBoard).toHaveValue('第一课 把字句', { timeout: 10000 });
  await expect(sBoard).toHaveAttribute('data-page', page1, { timeout: 10000 });
  await expect(sBoard).toHaveValue('第一课 把字句');

  // ---- The student turns a page herself (following stops); the tutor brings her back.
  await sp.getByTestId('board-page-thumb').nth(1).click();
  await expect(sBoard).toHaveAttribute('data-page', page2, { timeout: 10000 });
  await expect(tp.getByTestId('board-follow-bar')).toContainText('Jerome is on page 2', { timeout: 10000 });
  await tp.getByTestId('board-summon').click();
  await expect(sBoard).toHaveAttribute('data-page', page1, { timeout: 10000 });
  await expect(sp.getByTestId('board-page-notice')).toContainText('王老师 brought you to page 1');

  // ---- Rename page 1; add a page 3 and delete it.
  await tp.getByTestId('board-page-more').click();
  await tp.getByTestId('board-page-menu').getByRole('menuitem', { name: 'Rename' }).click();
  await tp.getByTestId('board-page-title').fill('把字句');
  await tp.getByRole('button', { name: 'Save' }).click();
  await expect(sp.locator('.bp-num').first()).toHaveText('把字句', { timeout: 10000 });
  await tp.getByTestId('board-page-new').click();
  await expect(sp.getByTestId('board-page-thumb')).toHaveCount(3, { timeout: 10000 });
  await tp.getByTestId('board-page-more').click();
  await tp.getByTestId('board-page-menu').getByRole('menuitem', { name: 'Delete…' }).click();
  await tp.getByTestId('board-page-delete-confirm').click();
  await expect(sp.getByTestId('board-page-thumb')).toHaveCount(2, { timeout: 10000 });
  await expect(tBoard).toHaveAttribute('data-page', page2, { timeout: 10000 });

  // ---- End the call.
  tp.on('dialog', (d) => d.accept());
  await tp.getByTestId('end-call').click();
  await tp.getByTestId('end-confirm-end').click(); // round 4: End asks first (a sheet, not a dialog)
  await tp.getByTestId('call-ended').waitFor({ timeout: 20000 });

  // The call remembers the pages it wrote on; the relationship keeps them.
  await expect.poll(async () => {
    const d = await api<{ board_text: string }>(request, `/api/calls/${call.id}`, { token: student.token });
    return d.board_text;
  }, { timeout: 20_000 }).toBe('— 把字句 —\n第一课 把字句\n\n— Page 2 —\n第二页');
  const { pages } = await api<{ pages: Array<{ id: string; number: number; title: string | null; text: string }> }>(request, `/api/relationships/${relId}/board-pages`, { token: student.token });
  expect(pages.map((p) => [p.number, p.title, p.text])).toEqual([[1, '把字句', '第一课 把字句'], [2, null, '第二页']]);

  await sp.goto(`/calls/${call.id}/review`);
  const board = sp.getByTestId('review-board-text');
  await expect(board).toContainText('把字句', { timeout: 15000 });
  await expect(board).toContainText('第二页');

  // ---- The Lesson board, online then offline.
  await sp.goto(`/connections/${relId}`);
  await expect(sp.getByTestId('lesson-board-link')).toContainText('2 pages', { timeout: 15000 });
  await sp.getByTestId('lesson-board-link').click();
  await expect(sp.getByTestId('lesson-board-page')).toContainText('第二页', { timeout: 10000 });
  // Offline (the dev server can't serve a lazy chunk offline — the PWA precaches it — so the page was opened once above).
  await sp.goBack();
  await expect(sp.getByTestId('lesson-board-link')).toBeVisible();
  await sp.context().setOffline(true);
  await sp.getByTestId('lesson-board-link').click();
  await expect(sp.getByTestId('lesson-board-page')).toContainText('第二页', { timeout: 10000 });
  await sp.getByTestId('board-page-thumb').first().click();
  await expect(sp.getByTestId('lesson-board-page')).toContainText('第一课 把字句');
  await sp.context().setOffline(false);

  // ---- A second call the same day continues the page written last.
  const second = await api<{ call: { id: string } }>(request, '/api/calls', { method: 'POST', token: student.token, data: { relationship_id: relId } });
  await join(tp, second.call.id);
  await tp.getByTestId('open-board').click();
  await expect(tp.getByTestId('text-board')).toHaveAttribute('data-page', page2, { timeout: 15000 });
  await expect(tp.getByTestId('text-board')).toHaveValue('第二页');
  await expect(tp.getByTestId('board-page-thumb')).toHaveCount(2);
});

test('only the two people of the relationship can read its board pages', async ({ request }) => {
  const tutor = await seedUser(request, 't2', 'T');
  const student = await seedUser(request, 's2', 'S');
  const stranger = await seedUser(request, 'x2', 'X');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
  expect((await api<{ pages: unknown[] }>(request, `/api/relationships/${rel.data.id}/board-pages`, { token: student.token })).pages).toEqual([]);
  const res = await request.fetch(`${API}/api/relationships/${rel.data.id}/board-pages`, { headers: { Authorization: `Bearer ${stranger.token}` } });
  expect(res.status()).toBe(404);
});
