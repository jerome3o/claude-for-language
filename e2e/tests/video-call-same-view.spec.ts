import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * "Same view" (docs/VIDEO_CALLS.md "Same view", shared/calls/view.ts): whatever either person
 * puts on the stage — a tile, a layout preset, a screen share — appears on the other screen too;
 * "My own view" stops that both ways until "Bring <name> to my view" / Same view again. Also:
 * the camera starts ON even when an older app remembered it off, and the tutor stops the
 * student's screen share (the student can't stop hers).
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const LAUNCH = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};

test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen'], ...LAUNCH },
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

async function seedPair(request: APIRequestContext) {
  const seed = async (tag: string, name: string) => {
    const email = `callf-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
    const r = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
    return { email, token: r.session_token };
  };
  const tutor = await seed('tutor', 'Minghui Wang');
  const student = await seed('student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
  const { call } = await api<{ call: { id: string } }>(request, '/api/calls', { method: 'POST', token: tutor.token, data: { relationship_id: rel.data.id } });
  return { tutor, student, callId: call.id };
}

const stage = (p: Page) => p.getByTestId('call-tiles');

test('Same view both ways, My own view, Bring to my view, shares for both; the tutor stops the student’s share', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const { tutor, student, callId } = await seedPair(request);
  const tp = await openAs(browser, tutor.token);
  const sp = await openAs(browser, student.token);
  // Round 4 remembered "camera off" — an old value in storage must not start the call dark.
  await tp.evaluate(() => localStorage.setItem('call-devices-v1', JSON.stringify({ camOff: true })));
  await joinCall(tp, callId);
  await joinCall(sp, callId);
  await expect(tp.getByTestId('call-cam')).toHaveAttribute('aria-label', 'Camera off');
  await expect.poll(() => sp.getByTestId('remote-video').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30000 }).toBeGreaterThan(0);
  await expect(sp.getByTestId('remote-video')).not.toHaveClass(/hidden/);
  await expect(tp.getByTestId('view-chip')).toHaveText('👥 Same view ✓');
  await expect(sp.getByTestId('view-chip')).toHaveText('👥 Same view ✓');

  // The tutor opens the board: the student's stage follows.
  await tp.getByTestId('open-board').click();
  await expect(stage(sp)).toHaveAttribute('data-stage', 'text', { timeout: 10000 });
  // Her board page turns take the student along.
  const tBoard = tp.getByTestId('text-board');
  const page1 = (await tBoard.getAttribute('data-page'))!;
  await tp.getByTestId('board-page-new').click();
  await expect(tBoard).not.toHaveAttribute('data-page', page1, { timeout: 10000 });
  const page2 = (await tBoard.getAttribute('data-page'))!;
  await expect(sp.getByTestId('text-board')).toHaveAttribute('data-page', page2, { timeout: 10000 });
  // …and so do the student's.
  await sp.getByTestId('board-page-thumb').first().click();
  await expect(tBoard).toHaveAttribute('data-page', page1, { timeout: 10000 });
  // Both pressing 📝 at once ("open the board") must not close it again: her press keeps the board up…
  await sp.getByTestId('open-board').click(); // the student closes it — for both
  await expect(stage(tp)).toHaveAttribute('data-stage', 'remote', { timeout: 10000 });
  await tp.getByTestId('open-board').click(); // she opens it…
  await sp.getByTestId('open-board').click(); // …and he presses too, a moment later
  await sp.waitForTimeout(800);
  await expect(stage(sp)).toHaveAttribute('data-stage', 'text');
  await expect(stage(tp)).toHaveAttribute('data-stage', 'text');
  // The student opens the chat: the tutor's stage follows (both ways).
  await sp.getByTestId('open-chat').click();
  await expect(stage(tp)).toHaveAttribute('data-stage', 'chat', { timeout: 10000 });
  await expect(stage(sp)).toHaveAttribute('data-stage', 'chat');
  // A layout preset too: Side by side on the tutor's ▦ → both cameras side by side for both.
  await tp.getByTestId('open-layout').click();
  await tp.getByTestId('preset-side').click();
  await expect(stage(tp)).toHaveAttribute('data-stage', 'remote,self');
  await expect(stage(sp)).toHaveAttribute('data-stage', 'remote,self', { timeout: 10000 });
  await expect(stage(sp)).toHaveAttribute('data-mode', 'split');

  // The student looks around on their own: nothing of theirs moves the tutor, nothing of hers moves them.
  await sp.getByTestId('view-chip').click();
  await sp.getByTestId('view-own').click();
  await expect(sp.getByTestId('view-chip')).toHaveText('👤 My own view');
  await expect(tp.getByTestId('they-own-view')).toContainText('Jerome is looking around on their own', { timeout: 10000 });
  await sp.getByTestId('open-board').click();
  await expect(stage(sp)).toHaveAttribute('data-stage', 'text');
  await tp.getByTestId('open-chat').click();
  await expect(stage(tp)).toHaveAttribute('data-stage', 'chat');
  await sp.waitForTimeout(1500);
  await expect(stage(sp)).toHaveAttribute('data-stage', 'text');
  await expect(stage(tp)).toHaveAttribute('data-stage', 'chat');

  // "Bring Jerome to my view": an invitation (never forced) — Join puts the tutor's view on their stage.
  await tp.getByTestId('view-chip').click();
  await tp.getByTestId('view-bring').click();
  await expect(sp.getByTestId('view-invite')).toContainText('Minghui wants you to see their view', { timeout: 10000 });
  await expect(stage(sp)).toHaveAttribute('data-stage', 'text');
  await sp.getByTestId('view-invite-join').click();
  await expect(stage(sp)).toHaveAttribute('data-stage', 'chat');
  await expect(sp.getByTestId('view-chip')).toHaveText('👥 Same view ✓');
  await expect(tp.getByTestId('they-own-view')).toHaveCount(0, { timeout: 10000 });

  // A reload keeps the shared view (welcome) — the student comes back on the chat.
  await sp.reload();
  await expect(sp.getByTestId('join-call')).toBeEnabled({ timeout: 20000 });
  await sp.getByTestId('record-toggle').uncheck();
  await sp.getByTestId('join-call').click();
  await sp.getByTestId('call-live').waitFor({ timeout: 20000 });
  await expect(stage(sp)).toHaveAttribute('data-stage', 'chat', { timeout: 10000 });

  // The student shares: the screen goes on BOTH stages (the sharer sees their own share too).
  await sp.getByLabel('Share screen').click();
  await expect(sp.getByTestId('share-bar')).toBeVisible({ timeout: 15000 });
  await expect(stage(sp)).toHaveAttribute('data-stage', 'screen', { timeout: 10000 });
  await expect(stage(tp)).toHaveAttribute('data-stage', 'screen', { timeout: 20000 });
  // Only the tutor gets "Stop their share".
  await expect(tp.getByTestId('stop-their-share')).toBeVisible({ timeout: 20000 });
  await expect(sp.getByTestId('stop-their-share')).toHaveCount(0);
  await tp.getByTestId('stop-their-share').click();
  await expect(sp.getByTestId('share-stopped-note')).toContainText('Minghui stopped your screen share', { timeout: 10000 });
  await expect(sp.getByTestId('share-bar')).toHaveCount(0);
  await expect(tp.getByTestId('stop-their-share')).toHaveCount(0, { timeout: 10000 });
  await sp.getByLabel('Share screen').waitFor();
});
