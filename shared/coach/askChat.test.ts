import { describe, expect, it } from 'vitest';
import {
  addRecapWord,
  addRecapWords,
  askCardChecked,
  askConversationTitle,
  conversationKind,
  readBackMistakeWords,
  readBackOffered,
  readBackReasonLine,
  recapCountLabel,
  recapFocusWords,
  type AskRecapWord,
} from './askChat';
import { judgeReadAloud } from '../reader/readAloud';

describe('conversationKind', () => {
  it('reads an Ask Claude chat and falls back to the sentence actions', () => {
    expect(conversationKind({ action: 'ask' })).toBe('ask');
    expect(conversationKind({ kind: 'ask', action: null })).toBe('ask');
    expect(conversationKind({ action: 'explain' })).toBe('explain');
    expect(conversationKind({ action: null, input_language: 'en' })).toBe('translate');
    expect(conversationKind({})).toBe('check');
  });
});

describe('askConversationTitle', () => {
  it('is the first question on one line, ≤ 120 characters', () => {
    expect(askConversationTitle('  成都有什么\n好吃的？  ')).toBe('成都有什么 好吃的？');
    const long = '吃'.repeat(200);
    const t = askConversationTitle(long);
    expect([...t]).toHaveLength(120);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('readBackOffered', () => {
  it('only on Claude’s finished Chinese answers', () => {
    expect(readBackOffered({ role: 'assistant', content: '成都的火锅很有名。', answer_lang: 'zh' })).toBe(true);
    expect(readBackOffered({ role: 'assistant', content: '成都的火锅很有名。', answer_lang: 'zh', status: 'pending' })).toBe(false);
    expect(readBackOffered({ role: 'assistant', content: 'Hot pot is famous.', answer_lang: 'en' })).toBe(false);
    expect(readBackOffered({ role: 'assistant', content: 'OK', answer_lang: 'zh' })).toBe(false);
    expect(readBackOffered({ role: 'user', content: '火锅', answer_lang: 'zh' })).toBe(false);
    expect(readBackOffered({ role: 'assistant', content: '好'.repeat(2001), answer_lang: 'zh' })).toBe(false);
  });
});

describe('addRecapWord', () => {
  const tapped = (hanzi: string, extra: Partial<AskRecapWord> = {}): AskRecapWord => ({ hanzi, sentence: `我喜欢${hanzi}。`, reasons: ['tapped'], ...extra });

  it('appends new words and merges a word seen again', () => {
    let list = addRecapWord([], tapped('火锅', { pinyin: 'huǒguō' }));
    list = addRecapWord(list, tapped('麻辣'));
    list = addRecapWord(list, { hanzi: ' 火锅 ', sentence: '另一句。', reasons: ['said_wrong'], gloss: 'hot pot', reason_line: 'Tone off on 锅' });
    expect(list).toEqual([
      { hanzi: '火锅', pinyin: 'huǒguō', gloss: 'hot pot', sentence: '我喜欢火锅。', reasons: ['tapped', 'said_wrong'], reason_line: 'Tone off on 锅' },
      { hanzi: '麻辣', sentence: '我喜欢麻辣。', reasons: ['tapped'] },
    ]);
  });

  it('ignores words without Chinese and keeps the newest max', () => {
    expect(addRecapWord([], tapped('OK'))).toEqual([]);
    const list = addRecapWords([], [tapped('一'), tapped('二'), tapped('三')], 2);
    expect(list.map((w) => w.hanzi)).toEqual(['二', '三']);
  });
});

describe('Read it back → recap words', () => {
  const text = '成都的火锅很辣。';
  const words = ['成都', '的', '火锅', '很', '辣', '。'];

  it('lists the words with a real mistake, with a reason line', () => {
    const r = judgeReadAloud(text, '成都的活过辣');
    const out = readBackMistakeWords(text, words, r);
    expect(out.map((w) => w.hanzi)).toEqual(['火锅', '很']);
    expect(out[0].reasons).toEqual(['said_wrong']);
    expect(out[0].sentence).toBe('成都的火锅很辣。');
    expect(out[1].reason_line).toBe('Missed 很');
    // Stopped before 辣: never reached, so not a mistake.
    expect(readBackMistakeWords(text, words, judgeReadAloud(text, '成都的活过很')).map((w) => w.hanzi)).toEqual(['火锅']);
  });

  it('nothing when read right; each character when the words don’t line up', () => {
    expect(readBackMistakeWords(text, words, judgeReadAloud(text, '成都的火锅很辣'))).toEqual([]);
    const r = judgeReadAloud(text, '成都的火锅辣');
    expect(readBackMistakeWords(text, ['nope'], r).map((w) => w.hanzi)).toEqual(['很']);
  });

  it('describes tone off, wrong and missed', () => {
    expect(
      readBackReasonLine([
        { char: '银', mark: 'close', heard: '音', extraBefore: '' },
        { char: '行', mark: 'wrong', heard: '星', extraBefore: '' },
        { char: '好', mark: 'missed', heard: '', extraBefore: '' },
        { char: '的', mark: 'ok', heard: '的', extraBefore: '' },
      ]),
    ).toBe('Tone off on 银 (heard 音) · heard 星 for 行 · missed 好');
  });
});

describe('flashcards from the chat', () => {
  const recap = [{ hanzi: '火锅' }, { hanzi: '麻辣' }];
  it('ticks the recap words that are new; everything new without a recap', () => {
    expect(askCardChecked({ hanzi: '火锅', already_have: false }, recap)).toBe(true);
    expect(askCardChecked({ hanzi: '火锅', already_have: true }, recap)).toBe(false);
    expect(askCardChecked({ hanzi: '串串', already_have: false }, recap)).toBe(false);
    expect(askCardChecked({ hanzi: '串串', already_have: false }, [])).toBe(true);
  });
  it('sends at most 40 distinct focus words', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ hanzi: `词${i}` }));
    expect(recapFocusWords([{ hanzi: '火锅' }, { hanzi: ' 火锅' }])).toEqual(['火锅']);
    expect(recapFocusWords(many)).toHaveLength(40);
  });
  it('labels the recap row', () => {
    expect(recapCountLabel(0)).toBe('📝 No words to recap yet');
    expect(recapCountLabel(1)).toBe('📝 1 word to recap');
    expect(recapCountLabel(4)).toBe('📝 4 words to recap');
  });
});
