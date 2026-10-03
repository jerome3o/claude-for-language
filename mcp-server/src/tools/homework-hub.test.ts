import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { LibraryItem } from '../../../shared/homework';
import { compactLibraryItem, registerHomeworkHubTools, shapeLibrary } from './homework-hub';
import { registerNoteUpdateTool } from './notes';
import { describeCopyResults, updateStudentCopies } from './student-copies';
import type { ToolContext } from './context';
import { ApiError, type ApiClient } from '../api';

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;
interface Call { method: string; path: string; body?: unknown }

function fakeContext(routes: Record<string, (body?: unknown) => unknown>) {
  const tools = new Map<string, Handler>();
  const calls: Call[] = [];
  const respond = (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    const key = `${method} ${path}`;
    const route = routes[key] ?? routes[`${method} ${path.split('?')[0]}`];
    if (!route) return Promise.reject(new ApiError(404, `No fake route for ${key}`, null));
    try {
      return Promise.resolve(route(body));
    } catch (err) {
      return Promise.reject(err);
    }
  };
  const api = {
    get: (path: string, query?: Record<string, unknown>) => respond('GET', query && Object.keys(query).length ? `${path}?${new URLSearchParams(query as Record<string, string>)}` : path),
    post: (path: string, body?: unknown) => respond('POST', path, body ?? {}),
    put: (path: string, body?: unknown) => respond('PUT', path, body ?? {}),
    patch: (path: string, body?: unknown) => respond('PATCH', path, body ?? {}),
    delete: (path: string) => respond('DELETE', path),
  };
  const server = {
    tool: (name: string, _description: string, _shape: unknown, handler: Handler) => {
      tools.set(name, handler);
    },
  };
  const ctx = { server, api, env: {}, userId: 'tutor-1', userName: 'Tutor', userEmail: null } as unknown as ToolContext;
  return { ctx, tools, calls, api: api as unknown as ApiClient };
}

const text = (r: CallToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('');

const LINK = { id: 'link-1', title: '晴天', url: 'https://youtu.be/DYptgVvkVLQ', instructions: 'Sing along', thumbnail_url: 'https://i.ytimg.com/vi/DYptgVvkVLQ/hqdefault.jpg', created_at: '2026-10-01T09:00:00Z' };

describe('link homework tools', () => {
  it('create_link_homework saves in the tutor\'s account and never sends', async () => {
    const { ctx, tools, calls } = fakeContext({ 'POST /api/homework-links': () => ({ link: LINK }) });
    registerHomeworkHubTools(ctx);
    const out = JSON.parse(text(await tools.get('create_link_homework')!({ title: ' 晴天 ', url: 'youtu.be/DYptgVvkVLQ', instructions: 'Sing along' })));
    expect(calls).toEqual([{ method: 'POST', path: '/api/homework-links', body: { title: '晴天', url: 'https://youtu.be/DYptgVvkVLQ', instructions: 'Sing along' } }]);
    expect(calls.some((c) => c.path.includes('/homework') && c.path.includes('relationships'))).toBe(false);
    expect(out.link).toMatchObject({ id: 'link-1', site: 'YouTube', thumbnail_url: LINK.thumbnail_url });
    expect(out.message).toContain('Nothing has been sent');
    expect(out.message).toContain('assign_link_homework');
  });

  it('create_link_homework pre-validates with pickLinkHomework', async () => {
    const { ctx, tools, calls } = fakeContext({});
    registerHomeworkHubTools(ctx);
    const r = await tools.get('create_link_homework')!({ title: '', url: 'javascript:alert(1)' });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('url must be a web link');
    expect(text(r)).toContain('title is required');
    expect(calls).toEqual([]);
  });

  it('assign_link_homework posts one kind-link one-off item per relationship and reports per student', async () => {
    const { ctx, tools, calls } = fakeContext({
      'POST /api/relationships/rel-1/homework': () => ({ assignments: [{ id: 'a1', title: '晴天', due_date: '2026-10-08' }], skipped: [], errors: [] }),
      'POST /api/relationships/rel-2/homework': () => {
        throw new ApiError(403, 'Not your student', null);
      },
    });
    registerHomeworkHubTools(ctx);
    const out = JSON.parse(text(await tools.get('assign_link_homework')!({ link_id: 'link-1', relationship_ids: ['rel-1'], relationship_id: 'rel-2', due_date: '2026-10-08', today: '2026-10-03', confirm: true })));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /api/relationships/rel-1/homework', 'POST /api/relationships/rel-2/homework']);
    expect(calls[0].body).toEqual({ items: [{ kind: 'link', source_id: 'link-1', mode: 'one_off', due_date: '2026-10-08' }], today: '2026-10-03' });
    expect(out.sent).toEqual([{ relationship_id: 'rel-1', assignment_id: 'a1', title: '晴天', due_date: '2026-10-08' }]);
    expect(out.errors).toEqual([{ relationship_id: 'rel-2', error: 'Not your student' }]);
    expect(out.message).toBe('SENT: 1 student(s) due Thu 8 Oct; 1 failed.');
  });

  it('assign_link_homework sends due_date null when there is none, and needs a student', async () => {
    const { ctx, tools, calls } = fakeContext({ 'POST /api/relationships/rel-1/homework': () => ({ assignments: [{ id: 'a1', title: '晴天', due_date: null }] }) });
    registerHomeworkHubTools(ctx);
    expect((await tools.get('assign_link_homework')!({ link_id: 'link-1', relationship_id: 'rel-1' })).isError).toBe(true); // no confirm: nothing sent
    expect((await tools.get('assign_link_homework')!({ link_id: 'link-1', confirm: true })).isError).toBe(true);
    expect((await tools.get('assign_link_homework')!({ link_id: 'link-1', relationship_id: 'rel-1', due_date: 'next week', confirm: true })).isError).toBe(true);
    expect(calls).toEqual([]);
    await tools.get('assign_link_homework')!({ link_id: 'link-1', relationship_id: 'rel-1', today: '2026-10-03', confirm: true });
    expect((calls[0].body as { items: Array<{ due_date: unknown }> }).items[0].due_date).toBeNull();
  });

  it('update_link_homework sends only the changed fields and update_student_copies only when asked', async () => {
    const { ctx, tools, calls } = fakeContext({
      'PUT /api/homework-links/link-1': () => ({ link: { ...LINK, title: '晴天 (live)' }, updated: 1, results: [{ relationship_id: 'rel-1', student_name: 'Anna', ok: true }] }),
      'GET /api/homework-links': () => ({ links: [LINK] }),
    });
    registerHomeworkHubTools(ctx);
    const out = JSON.parse(text(await tools.get('update_link_homework')!({ link_id: 'link-1', title: '晴天 (live)', update_student_copies: true })));
    expect(calls[0].body).toEqual({ title: '晴天 (live)', update_student_copies: true });
    expect(out.message).toBe("Updated \"晴天 (live)\". Also updated Anna's copy.");
    await tools.get('update_link_homework')!({ link_id: 'link-1', instructions: '', update_student_copies: false });
    expect(calls[1].body).toEqual({ instructions: null, update_student_copies: false });
    const list = JSON.parse(text(await tools.get('list_link_homework')!({})));
    expect(list.count).toBe(1);
  });
});

function item(over: Partial<LibraryItem>): LibraryItem {
  return {
    key: 'deck:d1', kind: 'deck', relationship_id: 'rel-1', student_id: 's1', student_name: 'Anna', title: 'Restaurant',
    source_id: 'src-1', target_id: 'd1', share_id: 'sh1', sent_at: '2026-09-28T10:00:00Z', due_date: '2026-10-01', mode: 'both',
    percent: 40, progress: '4 / 10 words', status: 'overdue', completed_at: null, assignment_ids: ['a1'], due_assignment_id: 'a1',
    behind: 2, url: null, instructions: null, thumbnail_url: null, student_note: null, ...over,
  };
}

describe('get_homework_library', () => {
  const items = [
    item({}),
    item({ key: 'link:a2', kind: 'link', title: '晴天', student_name: 'Ben', relationship_id: 'rel-2', target_id: 'link-1', source_id: 'link-1', share_id: null, status: 'completed', percent: 100, progress: 'done', due_date: null, due_assignment_id: null, behind: 0, url: LINK.url, student_note: 'Loved it!', completed_at: '2026-10-02T08:00:00Z' }),
  ];

  it('trims a row to what a chat needs', () => {
    expect(compactLibraryItem(items[0], '2026-10-03')).toEqual({
      kind: 'deck', title: 'Restaurant', student_name: 'Anna', relationship_id: 'rel-1', sent: '2026-09-28', due_date: '2026-10-01',
      due: 'Was due 2 days ago', status: 'overdue', percent: 40, progress: '4 / 10 words', student_note: null,
      source_id: 'src-1', target_id: 'd1', due_assignment_id: 'a1', words_behind: 2,
    });
    const link = compactLibraryItem(items[1], '2026-10-03');
    expect(link).toMatchObject({ kind: 'link', url: LINK.url, student_note: 'Loved it!', status: 'completed' });
    expect(link).not.toHaveProperty('due');
    expect(link).not.toHaveProperty('words_behind');
    expect(link).not.toHaveProperty('share_id');
  });

  it('filters by status / kind / text', () => {
    expect(shapeLibrary(items, '2026-10-03', { status: 'completed' }).map((i) => i.title)).toEqual(['晴天']);
    expect(shapeLibrary(items, '2026-10-03', { kind: 'deck' }).map((i) => i.title)).toEqual(['Restaurant']);
    expect(shapeLibrary(items, '2026-10-03', { query: 'ben' }).map((i) => i.title)).toEqual(['晴天']);
  });

  it('reads one student or every student', async () => {
    const { ctx, tools, calls } = fakeContext({
      'GET /api/relationships/rel-1/homework-library': () => ({ items: [items[0]], counts: { overdue: 1, in_progress: 0, not_started: 0, completed: 0 }, today: '2026-10-03' }),
      'GET /api/tutor/homework-library': () => ({ students: [{ relationship_id: 'rel-1', student_name: 'Anna' }], items, counts: {}, today: '2026-10-03' }),
    });
    registerHomeworkHubTools(ctx);
    const one = JSON.parse(text(await tools.get('get_homework_library')!({ relationship_id: 'rel-1', today: '2026-10-03' })));
    expect(one.count).toBe(1);
    expect(one.items[0].title).toBe('Restaurant');
    const all = JSON.parse(text(await tools.get('get_homework_library')!({ kind: 'link', today: '2026-10-03' })));
    expect(all.items.map((i: { title: string }) => i.title)).toEqual(['晴天']);
    expect(all.students).toHaveLength(1);
    expect(calls.map((c) => c.path)).toEqual(['/api/relationships/rel-1/homework-library?today=2026-10-03', '/api/tutor/homework-library?today=2026-10-03']);
  });
});

describe('update_student_copies on update_note', () => {
  const routes = {
    'PUT /api/notes/n1': () => ({ id: 'n1', deck_id: 'deck-1', hanzi: '菜单', pinyin: 'càidān', english: 'menu' }),
    'POST /api/student-copies/update': () => ({ updated: 2, results: [{ relationship_id: 'rel-1', student_name: 'Anna', ok: true }, { relationship_id: 'rel-2', student_name: 'Ben', ok: true }] }),
  };

  it('true (the tutor asked) updates the copies of the note\'s deck and says so', async () => {
    const { ctx, tools, calls } = fakeContext(routes);
    registerNoteUpdateTool(ctx);
    const r = await tools.get('update_note')!({ note_id: 'n1', english: 'menu', update_student_copies: true });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PUT /api/notes/n1', 'POST /api/student-copies/update']);
    expect(calls[0].body).toEqual({ english: 'menu' });
    expect(calls[1].body).toEqual({ kind: 'deck', source_id: 'deck-1' });
    expect(text(r)).toContain("Also updated Anna's and Ben's copies.");
  });

  it('false leaves the copies alone', async () => {
    const { ctx, tools, calls } = fakeContext(routes);
    registerNoteUpdateTool(ctx);
    const r = await tools.get('update_note')!({ note_id: 'n1', english: 'menu', update_student_copies: false });
    expect(calls.map((c) => c.path)).toEqual(['/api/notes/n1']);
    expect(text(r)).not.toContain('Also updated');
  });

  it('a failing copies update never fails the edit', async () => {
    const { ctx, tools } = fakeContext({ 'PUT /api/notes/n1': routes['PUT /api/notes/n1'] });
    registerNoteUpdateTool(ctx);
    const r = await tools.get('update_note')!({ note_id: 'n1', english: 'menu', update_student_copies: true });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("the students' copies could not be updated");
  });
});

describe('student copies helpers', () => {
  it('describes per-student results', () => {
    expect(describeCopyResults([])).toBe('');
    expect(describeCopyResults([{ relationship_id: 'r', student_name: 'Anna', ok: true }])).toBe("Also updated Anna's copy.");
    expect(describeCopyResults([
      { relationship_id: 'r1', student_name: 'Anna', ok: true },
      { relationship_id: 'r2', student_name: 'Ben', ok: true },
      { relationship_id: 'r3', student_name: 'Chen', ok: true },
      { relationship_id: 'r4', student_name: 'Dai', ok: false, error: 'copy deleted' },
    ])).toBe("Also updated Anna's, Ben's and Chen's copies. Couldn't update Dai's copy: copy deleted.");
  });

  it('does nothing when disabled', async () => {
    const { api, calls } = fakeContext({});
    expect(await updateStudentCopies(api, 'deck', 'd', false)).toBeNull();
    expect(calls).toEqual([]);
  });
});
