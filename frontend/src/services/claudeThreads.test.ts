import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/database';
import { applyTurnEvent, mergeMessage, sortMessages, type LocalClaudeMessage } from './claudeThreads';

const base: LocalClaudeMessage = {
  id: 'a1', thread_id: 't1', client_id: null, role: 'assistant', content_type: 'text', content: '', intent: null, status: 'pending', streaming: false,
  error: null, answer_lang: 'zh', translation: null, tool_results: null, created_at: '2026-11-03T10:00:01.000Z', updated_at: null,
};

describe('mergeMessage', () => {
  it('a poll’s shorter text never overwrites what the socket already streamed', () => {
    const local = { ...base, content: '这是一个好问题。我用', _seq: 5 };
    expect(mergeMessage(local, { ...base, content: '这是一个好问题。' }).content).toBe('这是一个好问题。我用');
    // Finished: the server's text wins.
    expect(mergeMessage(local, { ...base, status: null, content: '完整的回答。' })).toMatchObject({ content: '完整的回答。', status: null, _seq: 5 });
    // Different text (not a continuation): the server's.
    expect(mergeMessage(local, { ...base, content: '别的' }).content).toBe('别的');
  });
});

describe('applyTurnEvent', () => {
  beforeEach(async () => {
    await db.claudeMessages.clear();
    await db.claudeMessages.put({ ...base });
  });

  it('keeps the highest seq; a failure marks the reply failed', async () => {
    expect(await applyTurnEvent({ type: 'claude_turn', thread_id: 't1', message_id: 'a1', seq: 2, status: 'streaming', text: '你好' })).toBe(true);
    expect(await applyTurnEvent({ type: 'claude_turn', thread_id: 't1', message_id: 'a1', seq: 1, status: 'streaming', text: '你' })).toBe(false);
    expect((await db.claudeMessages.get('a1'))).toMatchObject({ content: '你好', streaming: true, _seq: 2 });
    expect(await applyTurnEvent({ type: 'claude_turn', thread_id: 'other', message_id: 'a1', seq: 9, status: 'streaming', text: 'x' })).toBe(false);
    await applyTurnEvent({ type: 'claude_turn', thread_id: 't1', message_id: 'a1', seq: 3, status: 'failed', error: 'Claude is busy' });
    expect(await db.claudeMessages.get('a1')).toMatchObject({ status: 'failed', error: 'Claude is busy', content: '你好' });
  });
});

describe('sortMessages', () => {
  it('by time, my message before its reply at the same time', () => {
    const at = '2026-11-03T10:00:00.000Z';
    const rows = [{ created_at: at, role: 'assistant' as const }, { created_at: at, role: 'user' as const }, { created_at: '2026-11-03T09:00:00.000Z', role: 'assistant' as const }];
    expect(sortMessages(rows).map((r) => `${r.created_at.slice(11, 13)}${r.role[0]}`)).toEqual(['09a', '10u', '10a']);
  });
});
