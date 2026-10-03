import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({
  createFolderApi: vi.fn(),
  updateFolderApi: vi.fn(),
  deleteFolderApi: vi.fn(),
  listFoldersApi: vi.fn(),
  moveToFolderApi: vi.fn(),
  reorderFoldersApi: vi.fn(),
}));
vi.mock('../api/folders', () => api);

import { db } from '../db/database';
import { createFolder, deleteFolder, moveItemsToFolder, readCollapsed, reorderFolders, replaceLocalFolders, syncFolders } from './folders';
import type { Folder } from '@shared/folders';

function folder(id: string, extra: Partial<Folder> = {}): Folder {
  return { id, user_id: 'u', kind: 'deck', name: id, parent_id: null, position: 0, created_at: '', updated_at: '', ...extra };
}

beforeEach(async () => {
  Object.values(api).forEach((fn) => fn.mockReset());
  await db.folders.clear();
  await db.decks.clear();
  localStorage.clear();
});

describe('folders on the device', () => {
  it('replaces the whole list from the server', async () => {
    await db.folders.put(folder('old'));
    await replaceLocalFolders([{ ...folder('a'), item_count: 3 } as Folder]);
    const rows = await db.folders.toArray();
    expect(rows.map((f) => f.id)).toEqual(['a']);
    expect(rows[0]).not.toHaveProperty('item_count');
  });

  it('a failed sync keeps what is cached', async () => {
    await db.folders.put(folder('cached'));
    api.listFoldersApi.mockRejectedValue(new Error('offline'));
    await syncFolders();
    expect((await db.folders.toArray()).map((f) => f.id)).toEqual(['cached']);
  });

  it('creates with a client id and stores the server row', async () => {
    api.createFolderApi.mockImplementation(async (input: { id: string; name: string; kind: 'deck' }) => ({ folder: folder(input.id, { name: input.name }) }));
    const f = await createFolder('deck', 'HSK 2');
    expect(api.createFolderApi.mock.calls[0][0]).toMatchObject({ kind: 'deck', name: 'HSK 2', parent_id: null });
    expect(typeof api.createFolderApi.mock.calls[0][0].id).toBe('string');
    expect((await db.folders.get(f.id))?.name).toBe('HSK 2');
  });

  it('moves decks on the device at once', async () => {
    await db.decks.put({ id: 'd1', name: 'D', folder_id: null } as never);
    api.moveToFolderApi.mockResolvedValue({ moved: 1, not_found: [], folder_id: 'f' });
    await moveItemsToFolder('deck', ['d1'], 'f');
    expect((await db.decks.get('d1'))?.folder_id).toBe('f');
    expect(api.moveToFolderApi).toHaveBeenCalledWith('deck', ['d1'], 'f');
  });

  it('delete puts decks back in Unfiled and lifts subfolders', async () => {
    await db.folders.bulkPut([folder('top'), folder('sub', { parent_id: 'top' })]);
    await db.decks.bulkPut([{ id: 'd1', name: 'a', folder_id: 'top' }, { id: 'd2', name: 'b', folder_id: 'sub' }] as never);
    api.deleteFolderApi.mockResolvedValue({ deleted: true, unfiled: 1, lifted: 1 });
    await deleteFolder(folder('top'));
    expect(await db.folders.get('top')).toBeUndefined();
    expect((await db.folders.get('sub'))?.parent_id).toBeNull();
    expect((await db.decks.get('d1'))?.folder_id).toBeNull();
    expect((await db.decks.get('d2'))?.folder_id).toBe('sub');
  });

  it('reorders siblings locally and on the server', async () => {
    await db.folders.bulkPut([folder('a', { position: 0 }), folder('b', { position: 1 })]);
    api.reorderFoldersApi.mockResolvedValue({ reordered: 2 });
    await reorderFolders('deck', ['b', 'a']);
    expect((await db.folders.get('b'))?.position).toBe(0);
    expect(api.reorderFoldersApi).toHaveBeenCalledWith('deck', ['b', 'a']);
  });

  it('reads collapsed state defensively', () => {
    localStorage.setItem('folders-collapsed-v1:deck', '{bad json');
    expect(readCollapsed('deck')).toEqual([]);
    localStorage.setItem('folders-collapsed-v1:lesson', JSON.stringify(['a', 3, 'unfiled']));
    expect(readCollapsed('lesson')).toEqual(['a', 'unfiled']);
  });
});
