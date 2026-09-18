import { describe, it, expect } from 'vitest';
import { lessonToMarkdown, lessonToJson, lessonToCsv, lessonVocabRows, csvEscape, lessonExportFilename, lessonToExportSpec } from './export';
import { CustomLessonSpec } from './types';

const spec: CustomLessonSpec = {
  title: 'Ordering coffee',
  icon: '☕',
  description: 'Getting a drink at a café.',
  sections: [
    {
      title: 'Warm-up',
      exercises: [
        { type: 'note', title: 'The pattern', body: 'Use 我要 + thing.', sentences: [{ hanzi: '我要一杯咖啡', pinyin: 'wǒ yào yī bēi kāfēi', english: 'I want a coffee' }] },
        { type: 'scramble', english: 'I want a coffee', tiles: ['我', '要', '一杯', '咖啡'], correct_order: ['我', '要', '一杯', '咖啡'], alt_orders: [['我', '要', '咖啡', '一杯']] },
      ],
    },
    {
      exercises: [
        { type: 'choice', question: 'You want tea. What do you say?', options: [{ hanzi: '我要茶', english: 'I want tea' }, { hanzi: '我是茶' }], correct: 0, explanation: '是 means "to be"' },
        { type: 'translate', english: 'Two coffees, please', reference_hanzi: '请给我两杯咖啡', reference_pinyin: 'qǐng gěi wǒ liǎng bēi kāfēi' },
        { type: 'match', pairs: [{ hanzi: '茶', pinyin: 'chá', english: 'tea' }, { hanzi: '水', english: 'water' }] },
        { type: 'describe_image', image_prompt: 'A busy café counter', reference_hanzi: '咖啡馆里有很多人', image_url: 'readers/abc.png' },
        { type: 'listen_choice', audio: { hanzi: '我又去了', pinyin: 'wǒ yòu qù le' }, options: [{ hanzi: '又' }, { hanzi: '有' }], correct: 0 },
        { type: 'listen_translate', audio: { hanzi: '他喝茶', english: 'He drinks tea' } },
        { type: 'speak', prompt: 'Order an iced tea', example: { hanzi: '我要一杯冰茶', english: 'I want an iced tea' } },
      ],
    },
  ],
};

describe('lessonToMarkdown', () => {
  it('renders title, sections, numbered exercises and an answer key', () => {
    const md = lessonToMarkdown(spec);
    expect(md.startsWith('# ☕ Ordering coffee\n\nGetting a drink at a café.')).toBe(true);
    expect(md).toContain('## Warm-up');
    expect(md).toContain('**The pattern**');
    expect(md).toContain('- 我要一杯咖啡 *wǒ yào yī bēi kāfēi* — I want a coffee');
    // Notes are not numbered; the scramble is exercise 1
    expect(md).toContain('### 1.\n\n**Word order.**');
    expect(md).toContain('Tiles: `我` `要` `一杯` `咖啡`');
    expect(md).toContain('A. 我要茶');
    expect(md).toContain('| Chinese | Meaning |');
    // Answers only in the key
    const [body, key] = md.split('## Answer key');
    expect(body).not.toContain('请给我两杯咖啡');
    expect(key).toContain('1. 我要一杯咖啡 (also: 我要咖啡一杯)');
    expect(key).toContain('2. A. 我要茶 — I want tea (是 means "to be")');
    expect(key).toContain('3. 请给我两杯咖啡 (qǐng gěi wǒ liǎng bēi kāfēi)');
    expect(key).toContain('4. 茶 = tea; 水 = water');
    expect(key).toContain('6. Read aloud: 我又去了 (wǒ yòu qù le). Answer: A. 又');
    expect(key).toContain('7. Read aloud: 他喝茶. Answer: He drinks tea');
    expect(key).toContain('8. e.g. 我要一杯冰茶 — I want an iced tea');
  });

  it('omits the answer key when nothing has an answer', () => {
    const md = lessonToMarkdown({ title: 'Notes only', sections: [{ exercises: [{ type: 'note', body: 'Hi' }] }] });
    expect(md).not.toContain('Answer key');
  });
});

describe('lessonToJson', () => {
  it('round-trips and strips server-filled image keys', () => {
    const parsed = JSON.parse(lessonToJson(spec)) as CustomLessonSpec;
    expect(parsed.title).toBe('Ordering coffee');
    const img = parsed.sections[1].exercises[3];
    expect(img.type).toBe('describe_image');
    expect('image_url' in img).toBe(false);
    // The original is untouched
    const original = spec.sections[1].exercises[3];
    expect(original.type === 'describe_image' && original.image_url).toBe('readers/abc.png');
    expect(lessonToExportSpec(spec).sections).toHaveLength(2);
  });
});

describe('lessonToCsv', () => {
  it('harvests vocabulary rows without duplicates', () => {
    const rows = lessonVocabRows(spec);
    const terms = rows.map(r => r.term);
    expect(terms).toEqual(['我要一杯咖啡', '我要茶', '请给我两杯咖啡', '茶', '水', '咖啡馆里有很多人', '我又去了', '他喝茶', '我要一杯冰茶']);
    expect(rows.find(r => r.term === '茶')).toEqual({ term: '茶', definition: 'tea', example: 'chá' });
    expect(rows.find(r => r.term === '请给我两杯咖啡')).toEqual({ term: '请给我两杯咖啡', definition: 'Two coffees, please', example: 'qǐng gěi wǒ liǎng bēi kāfēi' });
  });

  it('writes a header and escapes commas and quotes', () => {
    const csv = lessonToCsv(spec);
    expect(csv.split('\n')[0]).toBe('term,definition,example');
    expect(csv).toContain('请给我两杯咖啡,"Two coffees, please",qǐng gěi wǒ liǎng bēi kāfēi');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('plain')).toBe('plain');
  });
});

describe('lessonExportFilename', () => {
  it('slugs the title and keeps the extension', () => {
    expect(lessonExportFilename(spec, 'md')).toBe('Ordering-coffee.md');
    expect(lessonExportFilename({ title: 'a/b: c?', sections: [] }, 'csv')).toBe('a-b-c.csv');
    expect(lessonExportFilename({ title: '   ', sections: [] }, 'json')).toBe('lesson.json');
  });
});
