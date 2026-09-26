import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * Video calls (experimental): a tutor and a student join the same call in two
 * browsers with Chromium's fake camera / microphone, connect over WebRTC,
 * share the whiteboard and chat, and end the call. Both microphones are
 * recorded and uploaded; the room's board + chat are saved with the call.
 *
 * Transcription itself is not exercised (no AI keys in CI): the pieces reach
 * the queue and fail there, which the review page reports.
 */

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

test('tutor and student connect, share the whiteboard and chat, and the call is saved with both recordings', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const tutor = await seedUser(request, 'tutor', '王老师');
  const student = await seedUser(request, 'student', 'Student');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });

  const tp = await openAs(browser, tutor.token);
  const sp = await openAs(browser, student.token);

  // ---- Tutor starts the call from the student's page
  await tp.goto(`/connections/${rel.data.id}`);
  await tp.getByTestId('start-video-call').click();
  await tp.waitForURL(/\/calls\/[^/]+$/);
  const callId = new URL(tp.url()).pathname.split('/')[2];
  await expect(tp.getByTestId('join-call')).toBeEnabled({ timeout: 20000 });
  await tp.getByTestId('join-call').click();
  await tp.getByTestId('call-waiting').waitFor({ timeout: 20000 });

  // ---- The student sees the live call on their tutor page and joins
  await sp.goto(`/connections/${rel.data.id}`);
  await sp.getByTestId('live-call-banner').waitFor({ timeout: 20000 });
  await join(sp, callId);

  // WebRTC connects both ways
  await expect(tp.getByTestId('remote-video')).toBeAttached({ timeout: 30000 });
  await expect(sp.getByTestId('remote-video')).toBeAttached({ timeout: 30000 });
  await expect(tp.locator('.call-remote-label')).not.toContainText('connecting', { timeout: 30000 });
  await expect(tp.getByTestId('rec-badge')).toBeVisible();

  // ---- Whiteboard: the tutor types a word, the student sees it arrive
  await tp.getByTestId('open-board').click();
  await tp.locator('.wb-tool', { hasText: 'T' }).click();
  const canvas = tp.getByTestId('whiteboard-canvas');
  await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(200);
  await canvas.click({ position: { x: 60, y: 60 } });
  await tp.getByTestId('whiteboard-text-input').fill('一杯咖啡');
  await tp.keyboard.press('Enter');
  const box = (await canvas.boundingBox())!;
  await tp.locator('.wb-tool', { hasText: '✏️' }).click();
  await tp.mouse.move(box.x + 40, box.y + 120);
  await tp.mouse.down();
  await tp.mouse.move(box.x + 160, box.y + 140, { steps: 8 });
  await tp.mouse.up();

  // ---- Chat both ways
  await sp.getByRole('button', { name: 'Chat' }).click();
  await sp.getByTestId('call-chat-input').fill('怎么说 a cup of coffee?');
  await sp.keyboard.press('Enter');
  await tp.getByRole('tab', { name: /Chat/ }).click();
  await expect(tp.getByText('a cup of coffee')).toBeVisible({ timeout: 10000 });

  // Let each recorder write at least one 10 s chunk.
  await tp.waitForTimeout(11_000);

  // ---- The tutor ends the call for everyone
  tp.on('dialog', (d) => d.accept());
  await tp.getByTestId('end-call').click();
  await tp.getByTestId('call-ended').waitFor({ timeout: 20000 });
  await sp.getByTestId('call-ended').waitFor({ timeout: 20000 });

  // Server: ended, board + chat saved, one recording piece per person uploaded and assembled.
  await expect.poll(async () => {
    const d = await api<{ call: { status: string }; board: unknown[]; chat: unknown[]; pieces: Array<{ user_id: string; audio_url: string | null }> }>(
      request, `/api/calls/${callId}`, { token: student.token },
    );
    const withAudio = new Set(d.pieces.filter((p) => p.audio_url).map((p) => p.user_id));
    return { status: d.call.status, board: d.board.length, chat: d.chat.length, tutor: withAudio.has(tutor.id), student: withAudio.has(student.id) };
  }, { timeout: 45_000, intervals: [2000] }).toEqual({ status: 'ended', board: 2, chat: 1, tutor: true, student: true });

  // The review page opens for both and shows the call.
  await sp.getByRole('button', { name: /Transcript/ }).click();
  await expect(sp.getByRole('heading', { name: /Lesson with 王老师/ })).toBeVisible({ timeout: 15000 });
  await expect(sp.getByRole('heading', { name: 'Whiteboard' })).toBeVisible({ timeout: 15000 });
  await expect(sp.getByText('怎么说 a cup of coffee?')).toBeVisible();
});
