import { describe, expect, it } from 'vitest';
import {
  alignPatternExample, examplePartsFor, noteTextBlocks, parsePatternLine, patternLine, patternName, pieceTones, slotClass,
  structureNoteView, validExampleParts,
} from './pattern';
import { ALL_STRUCTURES_NOTE, PLAIN_NOTES, STRUCTURE_FOUR_NOTE, STRUCTURE_ONE_NOTE } from './__fixtures__/structures';
import type { LessonPattern, PatternExamplePart, PatternPiece } from './types';
import { validateLessonSpec } from './validate';
import { SAMPLE_LESSONS } from './samples';
import { exerciseTtsTexts } from './types';

/** "[除了:0][跑步:1]，…" — a compact picture of the parts. */
function show(parts: PatternExamplePart[]): string {
  return parts.map((p) => (p.piece === undefined ? p.text : `[${p.text}:${p.piece}]`)).join('');
}

describe('parsing the free-text structures of an older lesson', () => {
  const view = structureNoteView(ALL_STRUCTURES_NOTE)!;

  it('splits the "All structures" wall into five cards, one per structure', () => {
    expect(view.source).toBe('parsed');
    expect(view.cards).toHaveLength(5);
    expect(view.cards.map((c) => c.pattern.name)).toEqual(['①', '②', '③', '④', '⑤']);
    expect(view.cards.map((c) => c.pattern.meaning)).toEqual([
      'besides A, also B', '(not) easy to do', 'over X (twenty-odd, 100-plus…)', 'a bit over X', 'is starting to get [adjective]',
    ]);
    expect(view.extras).toEqual([]);
    expect(view.intro).toEqual([]);
  });

  it('reads ① into fixed words, slots, an optional word and the comma, labelled from the English line', () => {
    expect(view.cards[0].pattern.pieces).toEqual([
      { hanzi: '除了', english: 'Besides' },
      { slot: 'Noun / Verb phrase', zh: '名词／动词短语' },
      { hanzi: '以外', optional: true, english: 'apart from' },
      { hanzi: '，' },
      { slot: 'Subject', zh: '主语' },
      { hanzi: '还', english: 'also' },
      { slot: 'Verb', zh: '动词' },
    ]);
    expect(pieceTones(view.cards[0].pattern.pieces)).toEqual(['fixed', 's0', 'fixed', 'punct', 's1', 'fixed', 's2']);
  });

  it('reads ②–⑤', () => {
    expect(view.cards[1].pattern.pieces).toEqual([
      { hanzi: '不', optional: true, english: 'not' }, { hanzi: '好', english: 'easy to' }, { slot: 'Verb', zh: '动词' },
    ]);
    expect(view.cards[2].pattern.pieces).toEqual([
      { slot: 'Round number', zh: '整十数' }, { hanzi: '多', english: 'more' }, { slot: 'Measure word', zh: '量词' }, { slot: 'Noun', zh: '名词' },
    ]);
    expect(view.cards[3].pattern.pieces.map((p) => p.slot ?? p.hanzi)).toEqual(['Single digit', 'Measure word', '多', 'Noun']);
    // The English line has three pieces for two — the labels come from the grammar terms.
    expect(view.cards[4].pattern.pieces).toEqual([{ slot: 'Adjective', zh: '形容词' }, { hanzi: '起来了' }]);
  });

  it('matches each example sentence to its structure and colours its parts', () => {
    expect(view.cards.map((c) => c.examples.map((e) => show(e.parts)))).toEqual([
      ['[除了:0][跑步:1]，[他:4][还:5][喜欢游泳:6]。'],
      ['这个词[好:1][记:2]吗？'],
      ['这个城市有[三百:0][多:1][万:2][人:3]。'],
      ['我的猫[九:0][岁:1][多:2]了。'],
      ['咖啡馆里[热闹:0][起来了:1]。'],
    ]);
    expect(view.cards[0].examples[0].pinyin).toBe('Chúle pǎobù, tā hái xǐhuan yóuyǒng.');
  });

  it('keeps a structure note\'s usage, headings and ✗ / ✓ lines as blocks under its card', () => {
    const one = structureNoteView(STRUCTURE_ONE_NOTE)!;
    expect(one.cards).toHaveLength(1);
    expect(one.cards[0].examples.map((e) => show(e.parts))).toEqual([
      '[除了:0][中文:1]，[他:4][还:5][会说法语:6]。',
      '[除了:0][牛角包:1][以外:2]，[我:4][还:5][买了两杯咖啡:6]。',
    ]);
    expect(one.cards[0].blocks.map((b) => b.kind)).toEqual(['heading', 'text', 'heading', 'wrong', 'right']);
    expect(one.cards[0].blocks[3]).toEqual({ kind: 'wrong', text: '除了咖啡，还我喝茶。' });

    const four = structureNoteView(STRUCTURE_FOUR_NOTE)!;
    expect(four.cards[0].examples.map((e) => show(e.parts))).toEqual([
      '从这儿到机场要[一:0][个:1][多:2][小时:3]。',
      '我学中文学了[两:0][年:1][多:2]了。',
    ]);
    expect(four.cards[0].blocks.map((b) => b.text)).toContain('Before or after the measure word?');
  });

  it('leaves notes without structures alone (null = plain note, as before)', () => {
    for (const note of PLAIN_NOTES) expect(structureNoteView(note)).toBeNull();
    expect(structureNoteView({ body: '' })).toBeNull();
  });

  it('puts sentences that fit no structure after the cards', () => {
    const v = structureNoteView({ ...ALL_STRUCTURES_NOTE, sentences: [...ALL_STRUCTURES_NOTE.sentences!, { hanzi: '谢谢！' }] })!;
    expect(v.extras.map((s) => s.hanzi)).toEqual(['谢谢！']);
    expect(v.cards.map((c) => c.examples.length)).toEqual([1, 1, 1, 1, 1]);
  });
});

describe('parsePatternLine', () => {
  it('handles full-width ＋, Latin shorthands and V不V', () => {
    expect(parsePatternLine('动词＋回／上／下＋地点＋来／去')!.pieces).toEqual([
      { slot: 'Verb', zh: '动词' }, { hanzi: '回／上／下' }, { slot: 'Place', zh: '地点' }, { hanzi: '来／去' },
    ]);
    expect(parsePatternLine('1. Subj + V不V + O')!.pieces).toEqual([
      { slot: 'Subject' }, { slot: 'Verb' }, { hanzi: '不' }, { slot: 'Verb' }, { slot: 'Object' },
    ]);
  });
  it('refuses prose and patterns without a fixed word', () => {
    expect(parsePatternLine('好 before a verb + it describes the thing')).toBeNull();
    expect(parsePatternLine('名词 + 动词')).toBeNull();
    expect(parsePatternLine('我 + 你 = 我们。')).toBeNull();
  });
});

describe('alignPatternExample', () => {
  const pieces: PatternPiece[] = [{ slot: 'Adjective', zh: '形容词' }, { hanzi: '起来了' }];
  it('takes the predicate before the fixed word, not the subject', () => {
    expect(show(alignPatternExample(pieces, '天冷起来了。').parts)).toBe('天[冷:0][起来了:1]。');
    expect(show(alignPatternExample(pieces, '他最近胖起来了。').parts)).toBe('他最近[胖:0][起来了:1]。');
  });
  it('says when a fixed word is missing', () => {
    const r = alignPatternExample(pieces, '越来越冷了');
    expect(r.matched).toBe(false);
    expect(r.parts).toEqual([{ text: '越来越冷了' }]);
  });
  it('prefers the structure whose slots fit (round number vs single digit)', () => {
    const round = parsePatternLine('整十数 + 多 + 量词 + 名词')!.pieces;
    const digit = parsePatternLine('个位数 + 量词 + 多 + 名词')!.pieces;
    expect(alignPatternExample(round, '一百多块钱').score).toBeGreaterThan(alignPatternExample(digit, '一百多块钱').score);
    expect(alignPatternExample(digit, '九岁多').score).toBeGreaterThan(alignPatternExample(round, '九岁多').score);
  });
});

describe('author-given parts', () => {
  const pattern: LessonPattern = {
    pieces: [{ hanzi: '除了' }, { slot: 'Noun' }, { hanzi: '，' }, { slot: 'Subject' }, { hanzi: '还' }, { slot: 'Verb' }],
  };
  it('are used when they spell the example', () => {
    const parts = [{ text: '除了', piece: 0 }, { text: '咖啡', piece: 1 }, { text: '，' }, { text: '我', piece: 3 }, { text: '还', piece: 4 }, { text: '喝茶', piece: 5 }, { text: '。' }];
    expect(examplePartsFor(pattern, { hanzi: '除了咖啡，我还喝茶。', parts })).toEqual(parts);
  });
  it('are ignored (aligned instead) when they don\'t', () => {
    expect(validExampleParts({ hanzi: '除了咖啡，我还喝茶。', parts: [{ text: '除了', piece: 0 }] }, 6)).toBeNull();
    expect(validExampleParts({ hanzi: '除了', parts: [{ text: '除了', piece: 9 }] }, 6)).toBeNull();
    expect(show(examplePartsFor(pattern, { hanzi: '除了咖啡，我还喝茶。', parts: [{ text: 'x' }] }))).toBe('[除了:0][咖啡:1]，[我:3][还:4][喝茶:5]。');
  });
});

describe('colours, classes, text', () => {
  it('gives every fixed word one colour and each slot its own, cycling', () => {
    const pieces: PatternPiece[] = [
      { slot: 'A' }, { hanzi: '比' }, { slot: 'B' }, { slot: 'C' }, { slot: 'D' }, { slot: 'E' }, { slot: 'F' }, { hanzi: '。' },
    ];
    expect(pieceTones(pieces)).toEqual(['s0', 'fixed', 's1', 's2', 's3', 's4', 's0', 'punct']);
  });
  it('classes slots by their Chinese term, Latin shorthand or English label', () => {
    expect(slotClass({ slot: 'Round number', zh: '整十数' })).toBe('number');
    expect(slotClass({ slot: 'MW' })).toBe('measure');
    expect(slotClass({ slot: 'Adjective phrase' })).toBe('adjective');
    expect(slotClass({ slot: 'Whatever' })).toBe('other');
  });
  it('turns teaching text into headings, paragraphs and ✗ / ✓ rows', () => {
    expect(noteTextBlocks('Common mistake\n✗ 二十个多学生\n✓ 二十多个学生\n\nJust a line.')).toEqual([
      { kind: 'heading', text: 'Common mistake' }, { kind: 'wrong', text: '二十个多学生' }, { kind: 'right', text: '二十多个学生' },
      { kind: 'text', text: 'Just a line.' },
    ]);
  });
  it('writes the pattern as one line and names it', () => {
    const p = structureNoteView(ALL_STRUCTURES_NOTE)!.cards[0].pattern;
    expect(patternLine(p.pieces)).toBe('除了 + [Noun / Verb phrase] + (以外) + ， + [Subject] + 还 + [Verb]');
    expect(patternName(p)).toBe('除了…还…');
    expect(patternName({ name: '好 + V', pieces: [] })).toBe('好 + V');
  });
});

describe('patterns in the spec', () => {
  const sample = SAMPLE_LESSONS.find((l) => l.id === 'note')!;
  it('the catalogue sample is valid and renders from its own pieces', () => {
    expect(validateLessonSpec(sample.spec)).toEqual([]);
    const note = sample.spec.sections[0].exercises[0];
    if (note.type !== 'note') throw new Error('expected a note');
    const v = structureNoteView(note)!;
    expect(v.source).toBe('spec');
    expect(v.cards.length).toBeGreaterThanOrEqual(2);
    for (const card of v.cards) for (const e of card.examples) expect(e.parts.some((p) => p.piece !== undefined)).toBe(true);
    // Example clips are prefetched like the note's sentences.
    expect(exerciseTtsTexts(note)).toContain(v.cards[0].examples[0].hanzi);
  });

  it('validates pieces, examples and parts', () => {
    const spec = (patterns: unknown) => ({ title: 't', sections: [{ exercises: [{ type: 'note', patterns }] }] });
    const w = 'sections[0].exercises[0]';
    expect(validateLessonSpec(spec([]))).toEqual([`${w}: note needs "body" text, "sentences" and/or "patterns"`, `${w}: "patterns" must be a list of 1-8 structures`]);
    expect(validateLessonSpec(spec([{ pieces: [{ slot: 'Noun' }, { slot: 'Verb' }] }]))).toEqual([
      `${w}.patterns[0]: a pattern needs at least one fixed word (e.g. 除了) that is not optional`,
    ]);
    expect(validateLessonSpec(spec([{ pieces: [{ hanzi: '好', slot: 'x' }, { slot: 'Verb', optional: 'yes' }] }]))).toEqual([
      `${w}.patterns[0].pieces[0]: a piece is either a fixed word {hanzi} or a slot {slot} (an English label like "Noun")`,
      `${w}.patterns[0].pieces[1]: "optional" must be true or false`,
      `${w}.patterns[0]: a pattern needs at least one fixed word (e.g. 除了) that is not optional`,
    ]);
    expect(validateLessonSpec(spec([{
      pieces: [{ hanzi: '好' }, { slot: 'Verb' }],
      examples: [{ hanzi: '好写', parts: [{ text: '好', piece: 0 }, { text: '吃', piece: 1 }] }, { hanzi: '好', parts: [{ text: '好', piece: 2 }] }],
      image_prompt: ' ',
    }]))).toEqual([
      `${w}.patterns[0]: "image_prompt" must be a non-empty scene description`,
      `${w}.patterns[0].examples[0].parts must spell the example's hanzi exactly (got "好吃")`,
      `${w}.patterns[0].examples[1].parts: each part needs "text" and an optional "piece" (an index into "pieces")`,
    ]);
    // A note with only patterns is fine; a note with nothing is not.
    expect(validateLessonSpec(spec([{ pieces: [{ hanzi: '好' }, { slot: 'Verb' }] }]))).toEqual([]);
    expect(validateLessonSpec({ title: 't', sections: [{ exercises: [{ type: 'note' }] }] })).toEqual([
      `${w}: note needs "body" text, "sentences" and/or "patterns"`,
    ]);
  });
});
