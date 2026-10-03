/**
 * Round 4 (2 Oct 2026): Gboard keeps a composing span on the last word after
 * typing stops; the board used to hold every edit of the other person behind
 * it until a page switch. Now their edits go into the document at once and the
 * textarea catches up when the composition goes idle (COMPOSE_IDLE_MS) — here
 * a CDP composition that is never committed. Also: the other person's caret is
 * a line + a small dot (no name flag over the text); hovering near the dot
 * lights their name up under the board.
 */
import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

const API = process.env.E2E_API_URL || 'http://localhost:8787';

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    // A pre-installed Chromium (e.g. remote dev containers); CI uses Playwright's own.
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  },
  permissions: ['camera', 'microphone'],
  viewport: { width: 412, height: 915 },
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
  const email = `call-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

async function openAs(browser: Browser, token: string): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 412, height: 915 } });
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
  await page.getByTestId('call-live').waitFor({ timeout: 20000 });
}

test('an IME span that never closes does not hold the other person back; the caret is a dot, the name shows below on hover', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const tutor = await seedUser(request, 'tutor', '明慧');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
  const call = await api<{ call: { id: string } }>(request, '/api/calls', { method: 'POST', token: tutor.token, data: { relationship_id: rel.data.id } });

  const tp = await openAs(browser, tutor.token);
  const sp = await openAs(browser, student.token);
  await join(tp, call.call.id);
  await join(sp, call.call.id);
  await tp.getByTestId('open-board').click();
  // Round 5: the tutor opening the board shows it to the student (no click — a click would close it again).
  await expect(sp.getByTestId('call-tiles')).toHaveAttribute('data-stage', /text/, { timeout: 10000 });
  const tBoard = tp.getByTestId('text-board');
  const sBoard = sp.getByTestId('text-board');
  await tBoard.click();
  await tp.keyboard.type('今天');
  await expect(sBoard).toHaveValue('今天', { timeout: 10000 });

  // The student's IME opens a span and never commits it.
  await sBoard.click();
  await sp.keyboard.press('End');
  const cdp = await sp.context().newCDPSession(sp);
  await cdp.send('Input.imeSetComposition', { selectionStart: 3, selectionEnd: 3, text: 'hao' });
  await expect(tp.getByTestId('remote-compose')).toContainText('hao', { timeout: 5000 });

  // The tutor keeps typing: it reaches the student's board without the span ever closing.
  await tBoard.click();
  await tp.keyboard.press('End');
  await tp.keyboard.type('天气很好');
  await expect(sBoard).toHaveValue(/天气很好/, { timeout: 6000 });
  // What the student had composed counts as typed, after 今天 — both boards agree.
  await expect(sBoard).toHaveValue('今天hao天气很好');
  await expect(tBoard).toHaveValue('今天hao天气很好', { timeout: 6000 });

  // The student's caret on the tutor's board: a thin line + dot, no label over the text.
  const caret = tp.getByTestId('remote-caret');
  await expect(caret).toBeVisible();
  await expect(caret).not.toContainText('Jerome');
  const person = tp.getByTestId('remote-person');
  await expect(person).toContainText('Jerome');
  await expect(person).not.toHaveClass(/is-hover/);
  // (On a phone the faces box floats over the board's top-left corner, so the pointer is moved by event.)
  const box = (await caret.boundingBox())!;
  await tp.locator('.tb-paper').dispatchEvent('pointermove', { clientX: box.x + 1, clientY: box.y + 2, pointerType: 'mouse', bubbles: true });
  await expect(person).toHaveClass(/is-hover/);
  await expect(caret).toHaveClass(/is-hover/);
});
