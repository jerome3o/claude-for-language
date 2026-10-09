import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * Photo albums in the chat (docs/CHAT.md "Photo albums"): several photos picked
 * together arrive as ONE album bubble for both people (still one message per
 * photo), the tutor opens the viewer at a tile and swipes / steps through it,
 * the counter follows, Escape closes the viewer only, and the inbox row says
 * "📷 3 photos".
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
  const email = `chatalbum-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
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
  return { tutor, student, relId, convId: conv.body.id };
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
    cv.width = 120;
    cv.height = 90;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 120, 90);
    return cv.toDataURL('image/png').split(',')[1];
  }, color);
  return Buffer.from(b64, 'base64');
}

test('three photos at once → one album bubble → the viewer opens at a tile and swipes through', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { tutor, student, relId, convId } = await seedChat(request);
  await api(request, `/api/conversations/${convId}/messages`, { method: 'POST', token: tutor.token, data: { content: '发几张照片给我看看' } });
  const page = await openAs(browser, student, `/connections/${relId}/chat/${convId}`);
  await expect(page.getByText('发几张照片给我看看')).toBeVisible({ timeout: 20000 });

  const files = await Promise.all(['#f97316', '#2563eb', '#16a34a'].map(async (c, i) => ({ name: `p${i}.png`, mimeType: 'image/png', buffer: await png(page, c) })));
  await page.getByTestId('chat-photo-input').setInputFiles(files);
  await expect(page.getByTestId('photo-compose-strip').locator('img')).toHaveCount(3);
  await page.getByRole('textbox', { name: 'Caption' }).fill('我们的猫');
  await page.getByTestId('photo-send').click();

  // One album bubble with three tiles, the caption under it, the ticks inside it.
  const album = page.getByTestId('chat-album');
  await expect(album).toHaveCount(1, { timeout: 10000 });
  await expect(album.getByTestId('chat-album-tile')).toHaveCount(3);
  await expect(page.getByTestId('chat-send-pending')).toHaveCount(0, { timeout: 20000 });
  const bubble = page.getByTestId('chat-message').filter({ has: album });
  await expect(bubble).toContainText('我们的猫');
  await expect(bubble.getByTestId('chat-receipt')).toHaveCount(1);
  await expect(page.getByTestId('chat-photo')).toHaveCount(0);

  // On the server they are still three messages, one album.
  const list = await api<{ messages: Array<{ id: string; album_id: string | null; album_index: number | null; content: string }> }>(request, `/api/conversations/${convId}/messages`, { token: tutor.token });
  const photos = list.body.messages.filter((m) => m.album_id);
  expect(photos.map((m) => m.album_index)).toEqual([0, 1, 2]);
  expect(new Set(photos.map((m) => m.album_id)).size).toBe(1);
  expect(photos[0].content).toBe('我们的猫');

  // The tutor sees one album too; the inbox row says "📷 3 photos".
  const tutorPage = await openAs(browser, tutor, '/chats');
  await expect(tutorPage.getByText('📷 3 photos: 我们的猫')).toBeVisible({ timeout: 20000 });
  await tutorPage.goto(`/connections/${relId}/chat/${convId}`);
  const theirAlbum = tutorPage.getByTestId('chat-album');
  await expect(theirAlbum).toHaveCount(1, { timeout: 20000 });
  await expect(theirAlbum.getByTestId('chat-album-tile')).toHaveCount(3);
  await expect(theirAlbum.locator('.chat-album-tile.loaded')).toHaveCount(3, { timeout: 15000 });

  // Tap the second tile → the viewer at photo 2 of 3.
  await theirAlbum.getByTestId('chat-album-tile').nth(1).click();
  const viewer = tutorPage.getByTestId('chat-album-viewer');
  await expect(viewer).toBeVisible();
  const counter = tutorPage.getByTestId('chat-album-counter');
  await expect(counter).toHaveText('2 / 3');
  await expect(viewer).toContainText('我们的猫');

  // Swipe left (a pointer drag) → photo 3.
  const stage = viewer.locator('.chat-album-stage');
  const box = (await stage.boundingBox())!;
  await tutorPage.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
  await tutorPage.mouse.down();
  await tutorPage.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 6 });
  await tutorPage.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 6 });
  await tutorPage.mouse.up();
  await expect(counter).toHaveText('3 / 3');
  // The last photo: no next arrow; the keyboard steps back.
  await expect(tutorPage.getByTestId('chat-album-next')).toHaveCount(0);
  await tutorPage.keyboard.press('ArrowLeft');
  await expect(counter).toHaveText('2 / 3');
  await tutorPage.keyboard.press('ArrowLeft');
  await expect(counter).toHaveText('1 / 3');

  // Escape closes the viewer only — the chat stays.
  await tutorPage.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(theirAlbum).toBeVisible();
  expect(tutorPage.url()).toContain(`/chat/${convId}`);

  // Back (the Android back gesture) closes the viewer, not the chat.
  await theirAlbum.getByTestId('chat-album-tile').first().click();
  await expect(viewer).toBeVisible();
  await tutorPage.goBack();
  await expect(viewer).toHaveCount(0);
  expect(tutorPage.url()).toContain(`/chat/${convId}`);

  // Long-press menu of the album: whole-album actions.
  await bubble.getByRole('button', { name: 'More actions' }).click();
  await expect(page.locator('[data-tool="forward"]')).toContainText('Forward all 3');
  await expect(page.locator('[data-tool="delete"]')).toContainText('Delete all 3');
  await expect(page.locator('[data-tool="select"]')).toHaveCount(0);
});
