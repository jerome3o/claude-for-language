import { describe, it, expect } from 'vitest';
import { deckToAnki, lessonToAnki, readerToAnki, isWordLike, htmlField, cardProgress, type DeckSourceCard } from './sources';
import { guidFor } from './hash';
import type { CustomLessonSpec } from '@shared/lesson';

const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);

describe('helpers', () => {
  it('routes words vs sentences by shape', () => {
    expect(isWordLike('你好')).toBe(true);
    expect(isWordLike('一路平安')).toBe(true);
    expect(isWordLike('你好吗？')).toBe(false);
    expect(isWordLike('我今天很累')).toBe(false);
    expect(isWordLike('')).toBe(false);
  });

  it('escapes HTML and keeps line breaks in fields', () => {
    expect(htmlField(' a < b & c\nd ')).toBe('a &lt; b &amp; c<br>d');
    expect(htmlField(null)).toBe('');
  });
});

describe('deckToAnki', () => {
  const notes = [
    {
      id: 'n1', hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello', fun_facts: 'Greeting', context: null,
      sentence_clue: '你好吗？', sentence_clue_pinyin: 'nǐ hǎo ma', sentence_clue_translation: 'How are you?',
      audio_url: 'generated/n1.mp3', sentence_clue_audio_url: 'generated/n1-clue.mp3',
    },
    { id: 'n2', hanzi: '谢谢', pinyin: 'xiè xie', english: 'thanks', audio_url: null, sentence_clue: null, sentence_clue_audio_url: 'orphan.mp3' },
    { id: 'n3', hanzi: '  ', pinyin: '', english: 'blank — skipped' },
  ];
  const cards: DeckSourceCard[] = [
    { note_id: 'n1', card_type: 'hanzi_to_meaning', queue: 2, interval: 20, ease_factor: 2.3, repetitions: 6, lapses: 1, next_review_at: new Date(NOW + 5 * 86_400_000).toISOString() },
    { note_id: 'n1', card_type: 'meaning_to_hanzi', queue: 1, interval: 0, ease_factor: 250, repetitions: 1, lapses: 0, next_review_at: null },
    { note_id: 'n1', card_type: 'audio_to_hanzi', queue: 0, interval: 0, ease_factor: 2.5, repetitions: 0, lapses: 0, next_review_at: null },
  ];

  it('maps notes to Vocabulary notes with audio refs and stable GUIDs', () => {
    const src = deckToAnki({ name: 'HSK 1', description: 'Basics' }, notes, cards);
    expect(src.deckName).toBe('HSK 1');
    expect(src.notes).toHaveLength(2);
    const n1 = src.notes[0];
    expect(n1.model).toBe('vocabulary');
    expect(n1.guid).toBe(guidFor('note', 'n1'));
    expect(n1.fields.Hanzi).toBe('你好');
    expect(n1.fields.Sentence).toBe('你好吗？');
    expect(n1.fields.Notes).toBe('Greeting');
    expect(n1.fields.SourceId).toBe('note:n1');
    expect(n1.audio).toEqual({
      Audio: { kind: 'r2', key: 'generated/n1.mp3' },
      SentenceAudio: { kind: 'r2', key: 'generated/n1-clue.mp3' },
    });
    expect(n1.progress).toBeUndefined();
    // No note audio, and no clue → no clue audio even if a stray URL exists
    expect(src.notes[1].audio).toEqual({});
  });

  it('writes progress by template ordinal when asked', () => {
    const src = deckToAnki({ name: 'HSK 1' }, notes, cards, { progress: true, now: NOW });
    const p = src.notes[0].progress!;
    expect(p[0]).toMatchObject({ state: 'review', intervalDays: 20, ease: 2.3, reps: 6, lapses: 1 });
    expect(p[0].dueInDays).toBeCloseTo(5, 5);
    expect(p[1]).toMatchObject({ state: 'learning', ease: 2.5 }); // percent → multiplier
    expect(p[2]).toMatchObject({ state: 'new' });
    expect(src.notes[1].progress).toBeUndefined();
  });

  it('cardProgress defaults ease when missing', () => {
    expect(cardProgress({ note_id: 'x', card_type: 'hanzi_to_meaning', queue: 2, interval: 3, ease_factor: 0, repetitions: 1, lapses: 0, next_review_at: 'garbage' }, NOW))
      .toMatchObject({ ease: 2.5, dueInDays: 0, intervalDays: 3 });
  });
});

describe('lessonToAnki', () => {
  const spec: CustomLessonSpec = {
    title: 'Ordering coffee',
    description: 'Cafe basics',
    sections: [
      {
        title: 'Words',
        exercises: [
          { type: 'match', pairs: [{ hanzi: '咖啡', pinyin: 'kāfēi', english: 'coffee' }, { hanzi: '一杯', pinyin: 'yì bēi', english: 'one cup' }] },
          { type: 'note', title: 'Note', sentences: [{ hanzi: '我要一杯咖啡。', pinyin: 'wǒ yào yì bēi kāfēi', english: 'I want a cup of coffee.' }, { hanzi: '咖啡', english: 'dup — ignored' }] },
        ],
      },
      {
        exercises: [
          { type: 'translate', english: 'Two coffees please', reference_hanzi: '请给我两杯咖啡', reference_pinyin: 'qǐng gěi wǒ liǎng bēi kāfēi' },
          { type: 'choice', question: 'Hot?', options: [{ hanzi: '热的', english: 'hot' }, { hanzi: '冰的', english: 'iced' }], correct: 1 },
          { type: 'scramble', english: 'I want coffee', tiles: ['我', '要', '咖啡'], correct_order: ['我', '要', '咖啡'] },
          { type: 'listen_choice', audio: { hanzi: '有', pinyin: 'yǒu', english: 'have' }, options: [{ hanzi: '有' }, { hanzi: '又' }], correct: 0 },
          { type: 'listen_translate', audio: { hanzi: '我要一杯咖啡。', english: 'dup' } },
          { type: 'speak', prompt: 'Order', example: { hanzi: '一杯冰咖啡，谢谢。', english: 'One iced coffee, thanks.' } },
          { type: 'describe_image', image_prompt: 'a cafe', reference_hanzi: '他在喝咖啡。', reference_english: 'He is drinking coffee.' },
        ],
      },
    ],
  };

  it('collects words and sentences, deduped by hanzi', () => {
    const src = lessonToAnki(spec, { sourceId: 'L1' });
    expect(src.deckName).toBe('Lessons::Ordering coffee');
    const byHanzi = Object.fromEntries(src.notes.map(n => [n.fields.Hanzi ?? n.fields.Chinese, n]));
    expect(Object.keys(byHanzi)).toEqual(['咖啡', '一杯', '我要一杯咖啡。', '请给我两杯咖啡', '冰的', '我要咖啡', '有', '一杯冰咖啡，谢谢。', '他在喝咖啡。']);
    expect(byHanzi['咖啡'].model).toBe('vocabulary');
    expect(byHanzi['咖啡'].fields.English).toBe('coffee'); // first occurrence wins
    expect(byHanzi['冰的'].model).toBe('vocabulary');
    expect(byHanzi['有'].model).toBe('vocabulary');
    // a scramble's answer is a sentence even when it is only four characters
    expect(byHanzi['我要咖啡'].model).toBe('sentence');
    expect(byHanzi['一杯冰咖啡，谢谢。'].model).toBe('sentence');
    expect(byHanzi['我要一杯咖啡。'].model).toBe('sentence');
    expect(byHanzi['我要一杯咖啡。'].fields.English).toBe('I want a cup of coffee.');
    expect(byHanzi['我要一杯咖啡。'].guid).toBe(guidFor('sentence', '我要一杯咖啡。'));
    expect(byHanzi['我要一杯咖啡。'].audio).toEqual({ Audio: { kind: 'tts', text: '我要一杯咖啡。' } });
    expect(byHanzi['咖啡'].fields.SourceId).toBe('lesson:L1:咖啡');
    expect(src.notes.every(n => n.tags?.includes('lesson'))).toBe(true);
  });

  it('gives the same GUIDs across lessons so re-imports merge', () => {
    const other: CustomLessonSpec = { title: 'Other', sections: [{ exercises: [{ type: 'match', pairs: [{ hanzi: '咖啡', english: 'coffee' }] }] }] };
    expect(lessonToAnki(other).notes[0].guid).toBe(lessonToAnki(spec).notes[0].guid);
  });
});

describe('readerToAnki', () => {
  const reader = {
    id: 'r1',
    title_chinese: '小猫的一天',
    title_english: 'A cat\'s day',
    pages: [
      { id: 'p2', page_number: 2, content_chinese: '它去公园玩。', content_pinyin: 'tā qù gōngyuán wán', content_english: 'It goes to the park.' },
      { id: 'p1', page_number: 1, content_chinese: '小猫早上起床。', content_pinyin: 'xiǎo māo zǎoshang qǐchuáng', content_english: 'The kitten gets up in the morning.' },
    ],
    vocabulary_used: [{ hanzi: '公园', pinyin: 'gōngyuán', english: 'park' }, { hanzi: '公园', pinyin: 'x', english: 'dup' }],
  };

  it('makes a Sentence note per page (in order) and Vocabulary notes for the words', () => {
    const src = readerToAnki(reader);
    expect(src.deckName).toBe('Readers::小猫的一天');
    expect(src.notes.map(n => n.model)).toEqual(['sentence', 'sentence', 'vocabulary']);
    expect(src.notes[0].fields.Chinese).toBe('小猫早上起床。');
    expect(src.notes[0].fields.SourceId).toBe('reader:r1:page:1');
    expect(src.notes[0].guid).toBe(guidFor('reader-page', 'r1', '1'));
    expect(src.notes[0].audio).toEqual({ Audio: { kind: 'reader-page', pageId: 'p1', text: '小猫早上起床。' } });
    expect(src.notes[2].fields).toMatchObject({ Hanzi: '公园', Pinyin: 'gōngyuán', English: 'park' });
  });
});
