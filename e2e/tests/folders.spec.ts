import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Folders (shared/folders, routes/folders.ts): on More → Decks make a folder, move a
 * deck into it from its #N menu, reload — still filed (server + IndexedDB), collapse
 * it, reload — still collapsed (per device). The Library groups lessons the same way,
 * and deleting a folder sends its lesson back to Unfiled without deleting anything.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; token?: string; data?: unknown } = {},
): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function seedUser(request: APIRequestContext) {
  const email = `folders-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Minghui' } });
  return { id: r.user.id, token: r.session_token };
}

const LESSON = {
  title: '把 sentences',
  sections: [{ title: 'Practice', exercises: [{ type: 'note', title: '把', body: '把 moves the object before the verb.' }] }],
};

test('make a folder, move a deck in, reload — it stays filed and collapsed', async ({ page, request }) => {
  test.setTimeout(120_000);
  const me = await seedUser(request);
  await api(request, '/api/decks', { method: 'POST', token: me.token, data: { name: 'HSK 2 第一课' } });
  await api(request, '/api/decks', { method: 'POST', token: me.token, data: { name: '饭馆 Restaurant' } });

  await page.goto(`/decks?session_token=${me.token}`);
  await expect(page.getByTestId('deck-card')).toHaveCount(2, { timeout: 30_000 });

  // ＋ Folder → "HSK 2"
  await page.getByTestId('new-folder').click();
  await page.getByTestId('folder-name-input').fill('HSK 2');
  await page.getByTestId('folder-name-save').click();
  await expect(page.getByTestId('folder-group')).toHaveCount(1);
  await expect(page.getByTestId('folder-group').first()).toContainText('HSK 2');
  await expect(page.getByTestId('folder-group').first()).toContainText('Empty');

  // The deck's #N menu → Move to folder… → HSK 2
  const deck = page.getByTestId('deck-card').filter({ hasText: 'HSK 2 第一课' });
  await deck.getByTestId('queue-position').click();
  await deck.getByTestId('queue-menu-folder').click();
  const sheet = page.getByTestId('move-to-folder-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: /HSK 2/ }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText('Moved 1 deck to HSK 2')).toBeVisible();

  const group = page.getByTestId('folder-group').first();
  await expect(group.getByTestId('deck-card')).toHaveCount(1);
  await expect(group).toContainText('HSK 2 第一课');
  await expect(page.getByTestId('folder-group-unfiled')).toContainText('饭馆 Restaurant');

  // The server has it too.
  const decks = await api<Array<{ name: string; folder_id: string | null }>>(request, '/api/decks', { token: me.token });
  expect(decks.find((d) => d.name === 'HSK 2 第一课')?.folder_id).toBeTruthy();

  // Reload: still filed.
  await page.reload();
  await expect(page.getByTestId('folder-group').first().getByTestId('deck-card')).toHaveCount(1, { timeout: 30_000 });

  // Collapse, reload: still collapsed on this device.
  const folderId = decks.find((d) => d.name === 'HSK 2 第一课')!.folder_id!;
  await page.getByTestId(`folder-toggle-${folderId}`).click();
  await expect(page.getByTestId('folder-group').first().getByTestId('deck-card')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId(`folder-toggle-${folderId}`)).toHaveAttribute('aria-expanded', 'false', { timeout: 30_000 });
  await expect(page.getByTestId('folder-group').first().getByTestId('deck-card')).toHaveCount(0);

  // Expanding it again shows the deck.
  await page.getByTestId(`folder-toggle-${folderId}`).click();
  await expect(page.getByTestId('folder-group').first().getByTestId('deck-card')).toHaveCount(1);
});

test('library folders: group, multi-select move, delete → Unfiled', async ({ page, request }) => {
  test.setTimeout(120_000);
  const me = await seedUser(request);
  const a = await api<{ id: string }>(request, '/api/lesson-library', { method: 'POST', token: me.token, data: { spec: LESSON } });
  const b = await api<{ id: string }>(request, '/api/lesson-library', { method: 'POST', token: me.token, data: { spec: { ...LESSON, title: '了 completed actions' } } });
  const { folder } = await api<{ folder: { id: string } }>(request, '/api/folders', { method: 'POST', token: me.token, data: { kind: 'lesson', name: 'Grammar' } });

  await page.goto(`/library?session_token=${me.token}`);
  await expect(page.getByTestId('library-card')).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByTestId('folder-group')).toContainText('Grammar');

  // Select both → Move to folder… → Grammar
  await page.getByTestId('folder-select').click();
  await page.getByTestId('library-card').nth(0).click();
  await page.getByTestId('library-card').nth(1).click();
  await expect(page.getByTestId('folder-select-bar')).toContainText('2 selected');
  await page.getByTestId('folder-select-move').click();
  await page.getByTestId(`move-to-${folder.id}`).click();
  await expect(page.getByText('Moved 2 lessons to Grammar')).toBeVisible();
  await expect(page.getByTestId('folder-group').getByTestId('library-card')).toHaveCount(2);

  // Delete the folder: both lessons back in Unfiled, nothing deleted.
  await page.getByTestId('folder-menu').click();
  await page.getByTestId('folder-menu-delete').click();
  await expect(page.getByTestId('delete-folder-sheet')).toContainText('All 2 lessons move to Unfiled. Nothing is deleted.');
  await page.getByTestId('delete-folder-confirm').click();
  await expect(page.getByTestId('folder-group')).toHaveCount(0);
  await expect(page.getByTestId('library-card')).toHaveCount(2);
  const items = await api<{ items: Array<{ id: string; folder_id: string | null }> }>(request, '/api/lesson-library', { token: me.token });
  expect(items.items.map((i) => i.folder_id)).toEqual([null, null]);
  expect(new Set(items.items.map((i) => i.id))).toEqual(new Set([a.id, b.id]));
});
