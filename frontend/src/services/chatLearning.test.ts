import { describe, it, expect, beforeEach } from 'vitest';
import {
  EMPTY_DISPLAY_PREFS,
  batchNotesFrom,
  correctionDiff,
  correctionIsNoop,
  draftsFromProposal,
  isShown,
  loadDisplayPrefs,
  needsWords,
  proposeBodyFor,
  saveDisplayPrefs,
  setShownForAll,
  startOfLocalDay,
  toggleShown,
  usableWords,
  MAX_SELECTED_MESSAGES,
} from './chatLearning';
import type { MessageWithSender, ProposedChatCard } from '../types';

function msg(over: Partial<MessageWithSender>): MessageWithSender {
  return {
    id: 'm1',
    conversation_id: 'c1',
    sender_id: 'u1',
    content: '',
    created_at: '2026-10-02T10:00:00Z',
    check_status: null,
    check_feedback: null,
    recording_url: null,
    reply_to_message_id: null,
    translation: null,
    segmentation: null,
    sender: { id: 'u1', name: 'A', picture_url: null },
    ...over,
  };
}

describe('proposeBodyFor', () => {
  it('sends the picked ids (deduplicated, no pending bubbles)', () => {
    expect(proposeBodyFor({ kind: 'selected', ids: ['a', 'b', 'a', 'outbox:x'] })).toEqual({ message_ids: ['a', 'b'] });
  });
  it(`keeps at most ${MAX_SELECTED_MESSAGES} (the newest)`, () => {
    const ids = Array.from({ length: 100 }, (_, i) => `m${i}`);
    const body = proposeBodyFor({ kind: 'selected', ids });
    expect(body.message_ids).toHaveLength(MAX_SELECTED_MESSAGES);
    expect(body.message_ids![0]).toBe('m20');
  });
  it('one message, the correction focus, today and the last 50', () => {
    const now = new Date(2026, 9, 2, 15, 30);
    expect(proposeBodyFor({ kind: 'message', id: 'x' })).toEqual({ message_ids: ['x'] });
    expect(proposeBodyFor({ kind: 'correction', id: 'x' })).toEqual({ message_ids: ['x'], focus: 'correction' });
    expect(proposeBodyFor({ kind: 'today' }, now)).toEqual({ since: new Date(2026, 9, 2).toISOString() });
    expect(proposeBodyFor({ kind: 'last50' })).toEqual({});
    expect(startOfLocalDay(now).getHours()).toBe(0);
  });
});

describe('review sheet → batch', () => {
  const cards: ProposedChatCard[] = [
    { hanzi: '商店', pinyin: 'shāngdiàn', english: 'shop', fun_facts: '商 trade + 店 shop', sentence_clue: '我去商店。', sentence_clue_pinyin: 'Wǒ qù shāngdiàn.', sentence_clue_translation: 'I go to the shop.', already_have: false, source_message_id: 'm1' },
    { hanzi: '昨天', pinyin: 'zuótiān', english: 'yesterday', fun_facts: '', already_have: true, source_message_id: null },
  ];
  it('ticks everything except words already in my decks', () => {
    expect(draftsFromProposal(cards).map((d) => d.checked)).toEqual([true, false]);
  });
  it('sends the ticked cards with their edits, blanks left out', () => {
    const drafts = draftsFromProposal(cards);
    drafts[0] = { ...drafts[0], english: ' a shop ', sentence_clue_pinyin: '' };
    drafts[1] = { ...drafts[1], checked: true };
    expect(batchNotesFrom(drafts)).toEqual([
      { hanzi: '商店', pinyin: 'shāngdiàn', english: 'a shop', fun_facts: '商 trade + 店 shop', sentence_clue: '我去商店。', sentence_clue_translation: 'I go to the shop.' },
      { hanzi: '昨天', pinyin: 'zuótiān', english: 'yesterday' },
    ]);
  });
  it('drops a card emptied by editing', () => {
    const drafts = draftsFromProposal(cards);
    drafts[0] = { ...drafts[0], hanzi: '  ' };
    expect(batchNotesFrom(drafts)).toEqual([]);
  });
});

describe('pinyin / translation toggles', () => {
  beforeEach(() => localStorage.clear());
  it('per message, then for all, then a message opting out', () => {
    let p = toggleShown(EMPTY_DISPLAY_PREFS, 'pinyin', 'a');
    expect(isShown(p, 'pinyin', 'a')).toBe(true);
    expect(isShown(p, 'pinyin', 'b')).toBe(false);
    expect(isShown(p, 'translate', 'a')).toBe(false);
    p = setShownForAll(p, 'pinyin', true);
    expect(p.pinyin).toEqual({});
    expect(isShown(p, 'pinyin', 'b')).toBe(true);
    p = toggleShown(p, 'pinyin', 'b');
    expect(isShown(p, 'pinyin', 'b')).toBe(false);
    p = toggleShown(p, 'pinyin', 'b');
    expect(p.pinyin).toEqual({}); // back to following the switch
  });
  it('is remembered per conversation on the device', () => {
    const p = setShownForAll(toggleShown(EMPTY_DISPLAY_PREFS, 'translate', 'x'), 'pinyin', true);
    saveDisplayPrefs('conv1', p);
    expect(loadDisplayPrefs('conv1')).toEqual(p);
    expect(loadDisplayPrefs('conv2')).toEqual(EMPTY_DISPLAY_PREFS);
    localStorage.setItem('chat-display:bad', '{not json');
    expect(loadDisplayPrefs('bad')).toEqual(EMPTY_DISPLAY_PREFS);
  });
});

describe('word chips', () => {
  const words = [
    { text: '你好', pinyin: 'nǐ hǎo', gloss: 'hello' },
    { text: '！', pinyin: '', gloss: '' },
  ];
  it('uses words only while they match the text they were made for', () => {
    expect(usableWords(msg({ content: '你好！', words, words_source: 'content' }))).toBe(words);
    expect(usableWords(msg({ content: '你好吗！', words, words_source: 'content' }))).toBeNull();
    const voice = msg({
      content: '',
      attachment: { kind: 'voice', duration_ms: 1000, bytes: 1, mime: 'audio/webm', transcript_status: 'done', transcript: '你好！' },
      words,
      words_source: 'transcript',
    });
    expect(usableWords(voice)).toBe(words);
  });
  it('asks for words only for Chinese messages without them', () => {
    expect(needsWords(msg({ content: '你好！' }))).toBe(true);
    expect(needsWords(msg({ content: '你好！', words, words_source: 'content' }))).toBe(false);
    expect(needsWords(msg({ content: 'hello' }))).toBe(false);
    expect(needsWords(msg({ content: '你好', deleted_at: '2026-10-02' }))).toBe(false);
    expect(needsWords(msg({ id: 'outbox:1', content: '你好' }))).toBe(false);
    expect(needsWords(msg({ content: '你'.repeat(1501) }))).toBe(false);
    const pending = msg({ attachment: { kind: 'voice', duration_ms: 1, bytes: 1, mime: 'audio/webm', transcript_status: 'pending' } });
    expect(needsWords(pending)).toBe(false);
  });
});

describe('correctionDiff', () => {
  const rebuild = (parts: ReturnType<typeof correctionDiff>, skip: string[]) =>
    parts.filter((p) => !skip.includes(p.kind)).map((p) => p.text).join('');
  it('reads as the correction without the struck-out parts, and as the original without the written-in ones', () => {
    const cases: Array<[string, string]> = [
      ['我昨天去商店了买东西', '我昨天去商店买了东西。'],
      ['你好吗吗', '你好吗'],
      ['我很喜欢吃中国菜', '我非常喜欢吃中国菜！'],
      ['', '你好'],
    ];
    for (const [original, corrected] of cases) {
      const parts = correctionDiff(original, corrected);
      expect(rebuild(parts, ['del'])).toBe(corrected);
      expect(rebuild(parts, ['ins', 'punct'])).toBe(original);
      expect(parts.some((p) => p.kind === 'del' || p.kind === 'ins')).toBe(true);
    }
  });
  it('keeps the punctuation in place and merges runs', () => {
    expect(correctionDiff('我去商店', '我去了商店。')).toEqual([
      { text: '我去', kind: 'same' },
      { text: '了', kind: 'ins' },
      { text: '商店', kind: 'same' },
      { text: '。', kind: 'punct' },
    ]);
  });
  it('a replaced character is struck out, then written in', () => {
    expect(correctionDiff('他七点气床', '他七点起床')).toEqual([
      { text: '他七点', kind: 'same' },
      { text: '气', kind: 'del' },
      { text: '起', kind: 'ins' },
      { text: '床', kind: 'same' },
    ]);
  });
  it('knows a punctuation-only change', () => {
    expect(correctionIsNoop('你好', '你好！')).toBe(true);
    expect(correctionIsNoop('你好', '您好')).toBe(false);
  });
});
