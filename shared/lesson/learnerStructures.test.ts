import { describe, expect, it } from 'vitest';
import {
  learnerStructuresFromLessons,
  structureUsedBy,
  structuresForPrompt,
  structuresPromptBlock,
  type LearnerStructure,
} from './learnerStructures';
import type { CustomLessonSpec } from './types';

const besides: CustomLessonSpec = {
  title: '除了',
  sections: [{
    exercises: [{
      type: 'note',
      patterns: [{
        name: '除了…还…',
        pieces: [{ hanzi: '除了' }, { slot: 'Noun' }, { hanzi: '以外', optional: true }, { hanzi: '，' }, { slot: 'Subject' }, { hanzi: '还' }, { slot: 'Verb' }],
        meaning: 'besides A, also B',
        examples: [{ hanzi: '除了中文，我还学日语。' }],
      }],
    }, { type: 'choice', question: 'x', options: ['a', 'b'], answer: 0 } as never],
  }],
};

const planned: CustomLessonSpec = {
  title: '本来',
  sections: [{
    exercises: [{
      type: 'note',
      body: '① 本来 + 动词 + ，后来 + 动词\n→ originally …, later …',
      sentences: [{ hanzi: '我本来想去，后来没去。' }],
    }],
  }],
};

describe('learnerStructuresFromLessons', () => {
  it('collects patterns and parsed free-text structures from done lessons only', () => {
    const list = learnerStructuresFromLessons([
      { id: 'l1', spec: besides, completions: ['2026-10-01T10:00:00Z', '2026-10-08T10:00:00Z'] },
      { id: 'l2', spec: JSON.stringify(planned), completions: ['2026-11-02T10:00:00Z'] },
      { id: 'l3', spec: besides, completions: [] },
      { id: 'l4', spec: 'not json', completions: ['2026-11-03T10:00:00Z'] },
    ]);
    expect(list.map((s) => s.name)).toEqual(['本来…后来…', '除了…还…']);
    const b = list.find((s) => s.name === '除了…还…')!;
    expect(b.fixed).toEqual(['除了', '还']);
    expect(b.meaning).toBe('besides A, also B');
    expect(b.example).toBe('除了中文，我还学日语。');
    expect(b.first_met).toBe('2026-10-01T10:00:00Z');
    expect(b.last_met).toBe('2026-10-08T10:00:00Z');
    expect(b.lessons).toBe(1);
    expect(b.practised).toBe(2);
    const p = list[0];
    expect(p.fixed).toEqual(['本来', '后来']);
    expect(p.example).toBe('我本来想去，后来没去。');
  });

  it('merges the same structure across lessons', () => {
    const list = learnerStructuresFromLessons([
      { id: 'l1', spec: besides, completions: ['2026-10-01T10:00:00Z'] },
      { id: 'l2', spec: besides, completions: ['2026-11-01T10:00:00Z', '2026-11-02T10:00:00Z'] },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ lessons: 2, practised: 3, first_met: '2026-10-01T10:00:00Z', last_met: '2026-11-02T10:00:00Z' });
  });
});

const s = (name: string, last: string, practised: number, fixed: string[] = [name]): LearnerStructure => ({
  name, line: name, meaning: null, example: null, fixed, first_met: last, last_met: last, lessons: 1, practised,
});

describe('structuresForPrompt', () => {
  it('mixes the most recent and the most practised, without repeats', () => {
    const list = [s('A', '2026-11-05', 1), s('B', '2026-11-04', 9), s('C', '2026-11-03', 1), s('D', '2026-10-01', 7), s('E', '2026-09-01', 1)];
    expect(structuresForPrompt(list, 4).map((x) => x.name)).toEqual(['A', 'B', 'D', 'C']);
    expect(structuresForPrompt([], 4)).toEqual([]);
  });

  it('writes one line per structure', () => {
    expect(structuresPromptBlock([{ ...s('除了…还…', 'x', 1), line: '除了 + [Noun] + ， + 还 + [Verb]', meaning: 'besides' }]))
      .toBe('- 除了…还… (除了 + [Noun] + ， + 还 + [Verb]) — besides');
    expect(structuresPromptBlock([])).toBe('');
  });
});

describe('structureUsedBy', () => {
  const list = [s('除了…还…', 'x', 1, ['除了', '还']), s('本来…后来…', 'x', 1, ['本来', '后来']), s('还', 'x', 1, ['还'])];
  it('finds the structure whose fixed words appear in order (the longest)', () => {
    expect(structureUsedBy('除了银行，我还去了邮局。', list)).toBe('除了…还…');
    expect(structureUsedBy('我还没去银行。', list)).toBe('还');
    expect(structureUsedBy('后来我本来想去。', list)).toBeNull();
    expect(structureUsedBy('我去银行。', [])).toBeNull();
  });
});
