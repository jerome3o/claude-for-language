import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * 🧪 Group classes (EXPERIMENTAL prototype, docs/GROUP_CLASSES.md): a tutor
 * makes a group of two students, starts a class, and all three join in three
 * browsers with Chromium's fake camera / microphone. The mesh connects (every
 * tile shows video), the tutor mutes a student, a student raises a hand, the
 * chat, the shared board and the quick quiz reach everyone, and End closes the
 * class for all.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  },
  permissions: ['camera', 'microphone'],
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
  const email = `group-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

async function connect(request: APIRequestContext, tutor: SeededUser, student: SeededUser) {
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
}

async function openAs(browser: Browser, token: string): Promise<Page> {
  // Three apps at once: no service worker precaching the whole app in each.
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.goto(`/group-classes?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 60000 });
  return page;
}

async function joinClass(page: Page, sessionId: string) {
  await page.goto(`/group-class/${sessionId}`);
  await page.getByTestId('group-join').click();
  await page.getByTestId('group-live').waitFor({ timeout: 20000 });
}

/** Every tile but mine is showing the other person's (fake) camera. */
async function expectVideoFromEveryone(page: Page, people: number) {
  await expect(page.getByTestId('group-tile')).toHaveCount(people, { timeout: 20000 });
  await expect
    .poll(
      () => page.evaluate(() => [...document.querySelectorAll('[data-testid="group-tile"] video')].filter((v) => (v as HTMLVideoElement).videoWidth > 0).length),
      { timeout: 30000 },
    )
    .toBe(people);
}

test('a tutor and two students hold a group class: video mesh, mute, hands, chat, board, quiz, end', async ({ browser, request }) => {
  test.setTimeout(300_000);
  const tutor = await seedUser(request, 'tutor', '王老师');
  const anna = await seedUser(request, 'anna', 'Anna');
  const ben = await seedUser(request, 'ben', 'Ben');
  await connect(request, tutor, anna);
  await connect(request, tutor, ben);

  // Everyone's app is open first (the first load of a dev build is slow next to a live call).
  const tp = await openAs(browser, tutor.token);
  const ap = await openAs(browser, anna.token);
  const bp = await openAs(browser, ben.token);

  // ---- The tutor makes the group and starts the class
  await tp.getByTestId('new-group').click();
  await tp.getByTestId('group-name').fill('Tuesday HSK 3');
  await tp.getByTestId(`pick-${anna.id}`).check();
  await tp.getByTestId(`pick-${ben.id}`).check();
  await tp.getByTestId('group-save').click();
  await expect(tp.getByTestId('group-list')).toContainText('Tuesday HSK 3');
  await tp.getByTestId('start-class-quiet').click();
  await tp.waitForURL(/\/group-class\/[^/]+$/);
  const sessionId = new URL(tp.url()).pathname.split('/')[2];
  await tp.getByTestId('group-join').click();
  await tp.getByTestId('group-live').waitFor({ timeout: 20000 });

  // ---- Both students join from their own browsers
  await joinClass(ap, sessionId);
  await joinClass(bp, sessionId);
  for (const p of [tp, ap, bp]) await expectVideoFromEveryone(p, 3);

  // ---- Tutor controls: mute Anna — her mic goes off and she can't turn it back on
  await tp.locator(`[data-testid="group-tile"][data-user="${anna.id}"]`).getByTestId('tile-mute').click();
  await expect(ap.getByTestId('group-mic')).toHaveAttribute('aria-label', 'Unmute me');
  await expect(ap.getByRole('status')).toContainText('muted you');
  await ap.getByTestId('group-mic').click();
  await expect(ap.getByTestId('group-mic')).toHaveAttribute('aria-label', 'Unmute me');

  // ---- Ben raises his hand; the tutor sees it
  await bp.getByTestId('group-hand').click();
  await expect(tp.locator(`[data-testid="group-tile"][data-user="${ben.id}"] .gcl-hand`)).toBeVisible();

  // ---- Chat reaches everyone
  await ap.getByTestId('open-chat').click();
  await ap.getByTestId('group-chat-input').fill('老师好！');
  await ap.getByTestId('group-chat-input').press('Enter');
  await bp.getByTestId('open-chat').click();
  await expect(bp.getByTestId('group-chat-list')).toContainText('老师好！');

  // ---- The shared board
  await tp.getByTestId('open-board').click();
  await tp.locator('.tb-input').click();
  await tp.keyboard.type('今天我们学“把”字句');
  await bp.getByTestId('open-board').click();
  await expect(bp.locator('.tb-input')).toHaveValue(/今天我们学/, { timeout: 10000 });

  // ---- The quick quiz: Anna answers; the tutor sees who; the reveal shows everyone the counts
  await tp.getByTestId('open-quiz').click();
  await tp.getByTestId('quiz-question').fill('“bank” 是？');
  await tp.getByTestId('quiz-option-0').fill('银行');
  await tp.getByTestId('quiz-option-1').fill('很行');
  await tp.getByTestId('quiz-option-2').fill('银杏');
  await tp.getByTestId('quiz-ask').click();
  await ap.getByTestId('quiz-view').waitFor({ timeout: 10000 }); // opens by itself for students
  await ap.getByTestId('quiz-choice-0').click();
  await expect(tp.getByTestId('quiz-names-0')).toHaveText('Anna');
  await expect(bp.getByTestId('quiz-view')).toContainText('1 answered');
  await tp.getByTestId('quiz-reveal').click();
  await expect(bp.getByTestId('quiz-choice-0')).toHaveClass(/is-right/);

  // ---- End for everyone
  tp.once('dialog', (d) => void d.accept());
  await tp.getByTestId('group-end').click();
  await expect(ap.getByTestId('group-lobby')).toContainText('ended', { timeout: 15000 });
  await expect(bp.getByTestId('group-lobby')).toContainText('ended', { timeout: 15000 });

  for (const p of [tp, ap, bp]) await p.context().close();
});
