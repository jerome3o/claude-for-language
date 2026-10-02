import { describe, expect, it } from 'vitest';
import { messageMatches, searchMessages } from './search';

const msgs = [
  { id: 'a', content: '你好！今天的作业做完了吗？', translation: 'Hi! Have you finished today’s homework?' },
  { id: 'b', content: 'Not yet', words: null },
  { id: 'c', content: '', attachment: { kind: 'voice', transcript: '我今天晚上做', translation: 'I will do it tonight' } },
  { id: 'd', content: '别忘了练习', words: [{ text: '别', pinyin: 'bié' }, { text: '忘了', pinyin: 'wàng le' }, { text: '练习', pinyin: 'liànxí' }] },
  { id: 'e', content: '作业', deleted_at: '2026-10-01T00:00:00Z' },
];

describe('searchMessages', () => {
  it('matches hanzi, translation and voice transcripts, newest first', () => {
    expect(searchMessages(msgs, '作业')).toEqual(['a']);
    expect(searchMessages(msgs, 'HOMEWORK')).toEqual(['a']);
    expect(searchMessages(msgs, '今天')).toEqual(['c', 'a']);
    expect(searchMessages(msgs, 'tonight')).toEqual(['c']);
  });
  it('matches pinyin with or without tones and spaces when words exist', () => {
    expect(searchMessages(msgs, 'lianxi')).toEqual(['d']);
    expect(searchMessages(msgs, 'wàng le')).toEqual(['d']);
    expect(searchMessages(msgs, 'wangle')).toEqual(['d']);
  });
  it('never matches an empty query or a deleted message', () => {
    expect(searchMessages(msgs, '   ')).toEqual([]);
    expect(messageMatches(msgs[4], '作业')).toBe(false);
  });
});
