import { describe, expect, it } from 'vitest';
import { applyTurnFrame, mergeMessage, mergeThreadList, mergeThreadMessages, sortMessages, type CachedMessageFields, type CachedThreadFields } from './threadCache';
import { titleFor } from './context';

const msg = (id: string, over: Partial<CachedMessageFields> = {}): CachedMessageFields => ({
  id, client_id: null, role: 'assistant', created_at: '2026-11-03T10:00:01.000Z', status: null, content: '', streaming: false, error: null, ...over,
});

describe('sortMessages', () => {
  it('by time, my message before its reply at the same time', () => {
    const at = '2026-11-03T10:00:00.000Z';
    const rows = [msg('a', { created_at: at }), msg('u', { created_at: at, role: 'user' }), msg('b', { created_at: '2026-11-03T09:00:00.000Z' })];
    expect(sortMessages(rows).map((r) => r.id)).toEqual(['b', 'u', 'a']);
  });
});

describe('mergeMessage', () => {
  it('a poll’s shorter text never overwrites what the socket already streamed', () => {
    const local = msg('a', { status: 'pending', content: '这是一个好问题。我用', _seq: 5 });
    expect(mergeMessage(local, msg('a', { status: 'pending', content: '这是一个好问题。' }))).toMatchObject({ content: '这是一个好问题。我用', streaming: true, _seq: 5 });
    expect(mergeMessage(local, msg('a', { content: '完整的回答。' }))).toMatchObject({ content: '完整的回答。', status: null, _seq: 5 });
    expect(mergeMessage(local, msg('a', { status: 'pending', content: '别的' })).content).toBe('别的');
    expect(mergeMessage(undefined, msg('a'))._seq).toBeUndefined();
  });
});

describe('mergeThreadMessages', () => {
  it('replaces my optimistic row by the server’s and keeps queued ones on a full refresh', () => {
    const prev = [
      msg('c1', { client_id: 'c1', role: 'user', content: '你好', queued: true, created_at: '2026-11-03T10:00:00.000Z' }),
      msg('q2', { client_id: 'q2', role: 'user', content: '再见', queued: true, created_at: '2026-11-03T10:05:00.000Z' }),
      msg('old', { content: 'gone' }),
    ];
    const server = [msg('s1', { client_id: 'c1', role: 'user', content: '你好', created_at: '2026-11-03T10:00:00.000Z' }), msg('s2', { status: 'pending' })];
    const out = mergeThreadMessages(prev, server, { full: true });
    expect(out.messages.map((m) => m.id)).toEqual(['s1', 's2', 'q2']);
    expect(out.removed.sort()).toEqual(['c1', 'old']);
    // Not full: nothing else leaves.
    expect(mergeThreadMessages(prev, server).messages.map((m) => m.id)).toEqual(['s1', 'old', 's2', 'q2']);
  });
});

describe('applyTurnFrame', () => {
  it('keeps the highest seq; a failure marks the reply failed', () => {
    const row = msg('a', { status: 'pending' });
    const a = applyTurnFrame(row, { seq: 2, status: 'streaming', text: '你好' })!;
    expect(a).toMatchObject({ content: '你好', streaming: true, _seq: 2 });
    expect(applyTurnFrame(a, { seq: 1, status: 'streaming', text: '你' })).toBeNull();
    expect(applyTurnFrame(a, { seq: 3, status: 'failed', error: 'Claude is busy' })).toMatchObject({ status: 'failed', error: 'Claude is busy', content: '你好', streaming: false });
    expect(applyTurnFrame(msg('done'), { seq: 1, status: 'streaming', text: 'x' })).toBeNull();
  });
});

describe('mergeThreadList', () => {
  it('lays rows over the cache, drops deletions and folds a thread started offline into its server row', () => {
    type Row = CachedThreadFields & { title: string; cursor?: string };
    const prev: Row[] = [
      { id: 't1', client_id: null, title: 'old', cursor: 'k' },
      { id: 'c9', client_id: 'c9', title: 'offline', local: true },
      { id: 't3', client_id: null, title: 'bye' },
    ];
    const out = mergeThreadList<Row>(prev, [{ id: 't1', client_id: null, title: 'new' }, { id: 's9', client_id: 'c9', title: 'offline' }], ['t3', 'zz']);
    expect(out.threads).toEqual([{ id: 't1', client_id: null, title: 'new', cursor: 'k' }, { id: 's9', client_id: 'c9', title: 'offline' }]);
    expect(out.moved).toEqual([{ from: 'c9', to: 's9' }]);
    expect(out.removed).toEqual(['t3', 'zz']);
  });
});

describe('titleFor (a thread started offline)', () => {
  it('names a story / exercise thread with no first message', () => {
    expect(titleFor({ kind: 'reader', reader_id: 'r', label: '小明在巴黎' }, '')).toBe('About 小明在巴黎');
    expect(titleFor({ kind: 'exercise', lesson_id: 'l', exercise_key: 's0e1' }, '  ')).toBe('About an exercise');
  });
});
