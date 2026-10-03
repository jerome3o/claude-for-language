import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerFolderTools, matchFolderByName, resolveFolder, folderNames, filedNote, type ApiFolder } from './folders';
import type { ToolContext } from './context';
import type { ApiClient } from '../api';

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

function folder(id: string, name: string, extra: Partial<ApiFolder> = {}): ApiFolder {
  return { id, user_id: 'u1', kind: 'deck', name, parent_id: null, position: 0, created_at: '', updated_at: '', item_count: 0, ...extra };
}

const FOLDERS = [folder('f1', 'HSK 2', { item_count: 3 }), folder('f2', 'Week 1', { parent_id: 'f1' }), folder('l1', 'Grammar', { kind: 'lesson' })];

function fakeApi() {
  const calls: Array<{ method: string; path: string; body?: unknown; query?: unknown }> = [];
  const api = {
    get: async (path: string, query?: Record<string, string>) => {
      calls.push({ method: 'GET', path, query });
      return { folders: query?.kind ? FOLDERS.filter((f) => f.kind === query.kind) : FOLDERS };
    },
    post: async (path: string, body: any) => {
      calls.push({ method: 'POST', path, body });
      if (path === '/api/folders') return { folder: folder('new-1', body.name, { kind: body.kind }) };
      if (path === '/api/folders/move') return { moved: body.ids.length - 1, not_found: [body.ids[body.ids.length - 1]], folder_id: body.folder_id };
      return {};
    },
    patch: async (path: string, body: unknown) => { calls.push({ method: 'PATCH', path, body }); return { folder: folder('f1', 'Renamed') }; },
    delete: async (path: string) => { calls.push({ method: 'DELETE', path }); return { deleted: true, unfiled: 3, lifted: 1 }; },
  };
  return { api: api as unknown as ApiClient, calls };
}

function fakeContext() {
  const tools = new Map<string, Handler>();
  const { api, calls } = fakeApi();
  const server = { tool: (name: string, _d: string, _s: unknown, handler: Handler) => { tools.set(name, handler); } };
  registerFolderTools({ server, api, env: {}, userId: 'u1' } as unknown as ToolContext);
  return { tools, calls };
}

const text = (r: CallToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('');

describe('folder helpers', () => {
  it('matches by name, ignoring case and spacing, top level first', () => {
    expect(matchFolderByName(FOLDERS, 'deck', '  hsk 2 ')?.id).toBe('f1');
    expect(matchFolderByName(FOLDERS, 'lesson', 'HSK 2')).toBeNull();
    expect(matchFolderByName([folder('sub', 'X', { parent_id: 'p' }), folder('top', 'x')], 'deck', 'X')?.id).toBe('top');
    expect(matchFolderByName(FOLDERS, 'deck', '   ')).toBeNull();
  });
  it('names with the parent', () => {
    expect(folderNames(FOLDERS).get('f2')).toBe('HSK 2 › Week 1');
  });
  it('resolves an id, an existing name, or makes one', async () => {
    const { api, calls } = fakeApi();
    expect(await resolveFolder(api, 'deck', {})).toBeUndefined();
    expect(await resolveFolder(api, 'deck', { folder_id: 'f9', folder: 'ignored' })).toEqual({ id: 'f9', name: '', created: false });
    expect(await resolveFolder(api, 'deck', { folder: 'hsk 2' })).toEqual({ id: 'f1', name: 'HSK 2', created: false });
    expect(await resolveFolder(api, 'deck', { folder: 'Food' })).toEqual({ id: 'new-1', name: 'Food', created: true });
    expect(calls.filter((c) => c.method === 'POST')).toEqual([{ method: 'POST', path: '/api/folders', body: { kind: 'deck', name: 'Food' } }]);
    expect(filedNote({ name: 'Food', created: true })).toBe(' Filed in a new folder "Food".');
    expect(filedNote(undefined)).toBe('');
  });
});

describe('folder tools', () => {
  it('list_folders shows paths and counts', async () => {
    const { tools, calls } = fakeContext();
    const out = JSON.parse(text(await tools.get('list_folders')!({ kind: 'deck' })));
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/folders', query: { kind: 'deck' } });
    expect(out.folders.map((f: any) => [f.path, f.item_count])).toEqual([['HSK 2', 3], ['HSK 2 › Week 1', 0]]);
  });
  it('create / rename / delete call the API', async () => {
    const { tools, calls } = fakeContext();
    await tools.get('create_folder')!({ kind: 'reader', name: 'Stories' });
    await tools.get('rename_folder')!({ folder_id: 'f1', name: 'HSK 2 (2026)' });
    expect((await tools.get('rename_folder')!({ folder_id: 'f1' })).isError).toBe(true);
    const del = JSON.parse(text(await tools.get('delete_folder')!({ folder_id: 'f1' })));
    expect(del.message).toMatch(/nothing was deleted/);
    expect(calls).toEqual([
      { method: 'POST', path: '/api/folders', body: { kind: 'reader', name: 'Stories', parent_id: null } },
      { method: 'PATCH', path: '/api/folders/f1', body: { name: 'HSK 2 (2026)' } },
      { method: 'DELETE', path: '/api/folders/f1' },
    ]);
  });
  it('move_to_folder by name, by id, to Unfiled', async () => {
    const { tools, calls } = fakeContext();
    const byName = JSON.parse(text(await tools.get('move_to_folder')!({ kind: 'deck', ids: ['d1', 'd2', 'x'], folder: 'HSK 2' })));
    expect(byName.message).toBe('Moved 2 decks to HSK 2. Not found (not yours, or not a deck): x.');
    const unfiled = JSON.parse(text(await tools.get('move_to_folder')!({ kind: 'lesson', ids: ['l1', 'l2'], folder_id: null })));
    expect(unfiled.message).toMatch(/^Moved 1 lesson to Unfiled/);
    expect((await tools.get('move_to_folder')!({ kind: 'deck', ids: ['d1'] })).isError).toBe(true);
    expect(calls.filter((c) => c.path === '/api/folders/move').map((c) => c.body)).toEqual([
      { kind: 'deck', ids: ['d1', 'd2', 'x'], folder_id: 'f1' },
      { kind: 'lesson', ids: ['l1', 'l2'], folder_id: null },
    ]);
  });
});
