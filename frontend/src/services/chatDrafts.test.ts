import { describe, it, expect, beforeEach } from 'vitest';
import { loadDraft, saveDraft, queueLabel } from './chatDrafts';

describe('chat drafts', () => {
  beforeEach(() => localStorage.clear());

  it('keeps a draft per conversation and clears it when emptied', () => {
    saveDraft('a', '我明天');
    saveDraft('b', 'hello');
    expect(loadDraft('a')).toBe('我明天');
    expect(loadDraft('b')).toBe('hello');
    saveDraft('a', '   ');
    expect(loadDraft('a')).toBe('');
    expect(loadDraft(undefined)).toBe('');
  });

  it('keeps only the newest 50', () => {
    for (let i = 0; i < 55; i++) saveDraft(`c${i}`, `t${i}`, 1000 + i);
    expect(loadDraft('c0')).toBe('');
    expect(loadDraft('c54')).toBe('t54');
    expect(loadDraft('c5')).toBe('t5');
  });

  it('labels the queue', () => {
    expect(queueLabel(0, false)).toBeNull();
    expect(queueLabel(1, false)).toBe('🕓 1 message waiting for a connection');
    expect(queueLabel(3, true)).toBe('🕓 Sending 3 messages…');
  });
});
