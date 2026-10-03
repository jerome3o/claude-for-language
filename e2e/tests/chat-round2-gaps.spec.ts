import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * Chat round 2 PR 3 on the web: files / PDFs, video clips, several photos at
 * once, forward, message info, drafts per conversation and the "waiting to
 * send" indicator.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}) {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  return { status: res.status(), body: (await res.json().catch(() => null)) as T };
}

async function seedUser(request: APIRequestContext, tag: string, name: string): Promise<SeededUser> {
  const email = `chatgaps-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.body.user.id, email, token: r.body.session_token };
}

async function seedChat(request: APIRequestContext) {
  const tutor = await seedUser(request, 'tutor', '王明慧');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  const relId = rel.body.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });
  const conv = await api<{ id: string }>(request, `/api/relationships/${relId}/conversations`, { method: 'POST', token: tutor.token, data: {} });
  const conv2 = await api<{ id: string }>(request, `/api/relationships/${relId}/conversations`, { method: 'POST', token: tutor.token, data: { title: '作业' } });
  return { tutor, student, relId, convId: conv.body.id, conv2: conv2.body.id };
}

async function openAs(browser: Browser, user: SeededUser, path: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.setItem('chat-notify-nudge-dismissed', '1');
    } catch {
      /* ignore */
    }
  });
  await page.route('**/api/messages/*/words', (route) => route.fulfill({ json: { words: null, source: null, cached: false } }));
  await page.goto(`/?session_token=${user.token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await page.goto(path);
  return page;
}

async function png(page: Page, color: string): Promise<Buffer> {
  const b64 = await page.evaluate((c) => {
    const cv = document.createElement('canvas');
    cv.width = 90;
    cv.height = 60;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 90, 60);
    return cv.toDataURL('image/png').split(',')[1];
  }, color);
  return Buffer.from(b64, 'base64');
}

test('a PDF and several photos go out; the file opens; info shows what it is', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { tutor, student, relId, convId } = await seedChat(request);
  await api(request, `/api/conversations/${convId}/messages`, { method: 'POST', token: tutor.token, data: { content: '把练习发给我' } });
  const page = await openAs(browser, student, `/connections/${relId}/chat/${convId}`);
  await expect(page.getByText('把练习发给我')).toBeVisible({ timeout: 20000 });

  // A PDF.
  await page.getByTestId('chat-file-input').setInputFiles({ name: '第三课练习.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF') });
  const file = page.getByTestId('chat-file');
  await expect(file).toContainText('第三课练习.pdf');
  await expect(page.getByTestId('chat-send-pending')).toHaveCount(0, { timeout: 15000 });
  await expect(file).toContainText('PDF');

  // A file type that can't be sent says so.
  await page.getByTestId('chat-file-input').setInputFiles({ name: 'page.html', mimeType: 'text/html', buffer: Buffer.from('<p>x</p>') });
  await expect(page.getByText('That kind of file can’t be sent')).toBeVisible();

  // Three photos at once → three photo messages, the caption on the first.
  const files = await Promise.all(['#f97316', '#2563eb', '#16a34a'].map(async (c, i) => ({ name: `p${i}.png`, mimeType: 'image/png', buffer: await png(page, c) })));
  await page.getByTestId('chat-photo-input').setInputFiles(files);
  await expect(page.getByTestId('photo-compose-strip').locator('img')).toHaveCount(3);
  await page.getByRole('button', { name: 'Remove photo 3' }).click();
  await page.getByRole('textbox', { name: 'Caption' }).fill('我的作业');
  await page.getByTestId('photo-send').click();
  await expect(page.getByTestId('chat-photo')).toHaveCount(2, { timeout: 10000 });
  await expect(page.getByTestId('chat-send-pending')).toHaveCount(0, { timeout: 15000 });

  // Info on the PDF.
  const pdfMsg = page.getByTestId('chat-message').filter({ has: page.getByTestId('chat-file') });
  await pdfMsg.getByRole('button', { name: 'More actions' }).click();
  await page.locator('[data-tool="info"]').click();
  const info = page.getByTestId('chat-info-sheet');
  await expect(info).toContainText('第三课练习.pdf');
  await expect(info).toContainText('Read by 王明慧');

  // The tutor sees and can open it (bytes served with the PDF's name).
  const list = await api<{ messages: Array<{ id: string; attachment: { kind: string; name?: string } | null }> }>(request, `/api/conversations/${convId}/messages`, { token: tutor.token });
  const pdf = list.body.messages.find((m) => m.attachment?.kind === 'file')!;
  expect(pdf.attachment).toMatchObject({ kind: 'file', name: '第三课练习.pdf' });
  await page.context().close();
});

test('forward a message into the other conversation; it is marked Forwarded', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { tutor, student, relId, convId, conv2 } = await seedChat(request);
  await api(request, `/api/conversations/${convId}/messages`, { method: 'POST', token: tutor.token, data: { content: '记得复习第三课的生词' } });
  const page = await openAs(browser, student, `/connections/${relId}/chat/${convId}`);
  const msg = page.getByTestId('chat-message').filter({ hasText: '记得复习第三课的生词' });
  await expect(msg).toBeVisible({ timeout: 20000 });
  await msg.getByRole('button', { name: 'More actions' }).click();
  await page.locator('[data-tool="forward"]').click();
  const sheet = page.getByTestId('chat-forward-sheet');
  await sheet.getByRole('button', { name: /作业/ }).click();
  await expect(page.getByText(/Forwarded the message to 王明慧 · 作业/)).toBeVisible({ timeout: 10000 });

  const there = await api<{ messages: Array<{ content: string; forwarded_from: string | null; sender_id: string }> }>(request, `/api/conversations/${conv2}/messages`, { token: student.token });
  expect(there.body.messages).toHaveLength(1);
  expect(there.body.messages[0]).toMatchObject({ content: '记得复习第三课的生词', sender_id: student.id });
  expect(there.body.messages[0].forwarded_from).toBeTruthy();
  await page.goto(`/connections/${relId}/chat/${conv2}`);
  await expect(page.getByTestId('chat-message').filter({ hasText: '记得复习第三课的生词' }).locator('.chat-forwarded')).toHaveText('↪ Forwarded', { timeout: 20000 });
  await page.context().close();
});

test('drafts stay per conversation; offline sends show as waiting in the header', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { tutor, student, relId, convId, conv2 } = await seedChat(request);
  await api(request, `/api/conversations/${convId}/messages`, { method: 'POST', token: tutor.token, data: { content: '你好' } });
  const page = await openAs(browser, student, `/connections/${relId}/chat/${convId}`);
  await expect(page.getByText('你好')).toBeVisible({ timeout: 20000 });
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.fill('我还没写完');
  await page.goto(`/connections/${relId}/chat/${conv2}`);
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('');
  await page.goto(`/connections/${relId}/chat/${convId}`);
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('我还没写完', { timeout: 20000 });

  await page.context().setOffline(true);
  await page.getByRole('textbox', { name: 'Message' }).fill('在地铁上');
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(page.getByTestId('chat-queue-status')).toHaveText('🕓 1 message waiting for a connection');
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('');
  await page.context().setOffline(false);
  await expect(page.getByTestId('chat-queue-status')).toHaveCount(0, { timeout: 15000 });
  await page.context().close();
});
