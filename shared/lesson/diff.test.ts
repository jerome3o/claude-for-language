import { describe, it, expect } from 'vitest';
import { diffLessonSpecs, formatLessonDiff, canonicalJson } from './diff';
import { CustomLessonSpec } from './types';

function base(): CustomLessonSpec {
  return {
    title: 'Ordering coffee',
    icon: '☕',
    sections: [
      {
        title: 'Warm-up',
        exercises: [
          { type: 'note', title: 'The pattern', body: '我要 + thing', sentences: [{ hanzi: '我要一杯咖啡', pinyin: 'wǒ yào yī bēi kāfēi', english: 'I want a coffee' }] },
          { type: 'scramble', english: 'I want a coffee', tiles: ['我', '要', '一杯', '咖啡'], correct_order: ['我', '要', '一杯', '咖啡'] },
        ],
      },
      {
        title: 'Practice',
        exercises: [
          { type: 'choice', question: 'You want tea. What do you say?', options: [{ hanzi: '我要茶' }, { hanzi: '我是茶' }], correct: 0 },
          { type: 'translate', english: 'Two coffees please', reference_hanzi: '请给我两杯咖啡' },
        ],
      },
    ],
  };
}

function clone(spec: CustomLessonSpec): CustomLessonSpec {
  return JSON.parse(JSON.stringify(spec));
}

describe('canonicalJson', () => {
  it('ignores key order and undefined', () => {
    expect(canonicalJson({ b: 1, a: undefined, c: [{ y: 2, x: 1 }] })).toBe(canonicalJson({ c: [{ x: 1, y: 2 }], b: 1 }));
  });
});

describe('diffLessonSpecs', () => {
  it('reports no change for identical specs', () => {
    const d = diffLessonSpecs(base(), clone(base()));
    expect(d.changed).toBe(false);
    expect(formatLessonDiff(d)).toEqual([]);
  });

  it('ignores a server-filled image_url on describe_image', () => {
    const a = base();
    a.sections[0].exercises.push({ type: 'describe_image', image_prompt: 'a café', reference_hanzi: '一家咖啡馆', image_url: 'readers/x.png' });
    const b = clone(a);
    delete (b.sections[0].exercises[2] as { image_url?: string | null }).image_url;
    // Same exercise minus image_url: matched as a change with no visible fields → not reported as changed
    const d = diffLessonSpecs(a, b);
    const changed = d.exercises.filter(e => e.kind === 'changed');
    expect(changed).toHaveLength(1);
    expect(changed[0].kind === 'changed' && changed[0].fields).toEqual([]);
  });

  it('detects meta changes', () => {
    const b = clone(base());
    b.title = 'Ordering drinks';
    b.description = 'Cafés and tea houses';
    const d = diffLessonSpecs(base(), b);
    expect(d.meta.map(m => m.field).sort()).toEqual(['description', 'title']);
    expect(formatLessonDiff(d)[0]).toContain('Ordering drinks');
  });

  it('detects an added exercise', () => {
    const b = clone(base());
    b.sections[1].exercises.push({ type: 'speak', prompt: 'Order an iced tea' });
    const d = diffLessonSpecs(base(), b);
    expect(d.exercises).toEqual([
      expect.objectContaining({ kind: 'added', section: 1, index: 2 }),
    ]);
    expect(formatLessonDiff(d)[0]).toBe('Section 2, exercise 3: added speak "Order an iced tea"');
  });

  it('detects a removed exercise', () => {
    const b = clone(base());
    b.sections[0].exercises.splice(1, 1);
    const d = diffLessonSpecs(base(), b);
    expect(d.exercises).toEqual([expect.objectContaining({ kind: 'removed', section: 0, index: 1 })]);
  });

  it('detects an edited exercise with field-level detail', () => {
    const b = clone(base());
    const t = b.sections[1].exercises[1];
    if (t.type === 'translate') {
      t.reference_hanzi = '请来两杯咖啡';
      t.reference_pinyin = 'qǐng lái liǎng bēi kāfēi';
    }
    const d = diffLessonSpecs(base(), b);
    expect(d.exercises).toHaveLength(1);
    const e = d.exercises[0];
    expect(e.kind).toBe('changed');
    if (e.kind === 'changed') {
      expect(e.fields.map(f => f.field)).toEqual(['reference_hanzi', 'reference_pinyin']);
      expect(e.fields[0]).toEqual({ field: 'reference_hanzi', before: '请给我两杯咖啡', after: '请来两杯咖啡' });
    }
    expect(formatLessonDiff(d)[0]).toContain('changed translate "Two coffees please"');
  });

  it('pairs an exercise whose question was reworded but options kept', () => {
    const b = clone(base());
    const c = b.sections[1].exercises[0];
    if (c.type === 'choice') c.question = 'You would like tea. What do you say?';
    const d = diffLessonSpecs(base(), b);
    expect(d.exercises).toHaveLength(1);
    expect(d.exercises[0].kind).toBe('changed');
  });

  it('reports a move between sections rather than remove + add', () => {
    const b = clone(base());
    const [moved] = b.sections[0].exercises.splice(1, 1);
    b.sections[1].exercises.unshift(moved);
    const d = diffLessonSpecs(base(), b);
    expect(d.exercises).toEqual([
      expect.objectContaining({ kind: 'moved', fromSection: 0, fromIndex: 1, section: 1, index: 0 }),
    ]);
  });

  it('reports section adds, removes and renames', () => {
    const b = clone(base());
    b.sections[0].title = 'Intro';
    b.sections.push({ title: 'Extra', exercises: [{ type: 'speak', prompt: 'Say hi' }] });
    const d = diffLessonSpecs(base(), b);
    expect(d.sections).toEqual([
      { kind: 'renamed', index: 0, before: 'Warm-up', after: 'Intro' },
      { kind: 'added', index: 2, title: 'Extra', exerciseCount: 1 },
    ]);
    const removed = diffLessonSpecs(b, base());
    expect(removed.sections.find(s => s.kind === 'removed')).toEqual({ kind: 'removed', index: 2, title: 'Extra', exerciseCount: 1 });
  });

  it('does not pair exercises of different types', () => {
    const a: CustomLessonSpec = { title: 'x', sections: [{ exercises: [{ type: 'translate', english: 'Hello', reference_hanzi: '你好' }] }] };
    const b: CustomLessonSpec = { title: 'x', sections: [{ exercises: [{ type: 'speak', prompt: 'Hello' }] }] };
    const d = diffLessonSpecs(a, b);
    expect(d.exercises.map(e => e.kind).sort()).toEqual(['added', 'removed']);
  });

  it('formats a full change set as readable lines', () => {
    const b = clone(base());
    b.title = 'New';
    b.sections[0].exercises.push({ type: 'match', pairs: [{ hanzi: '茶', english: 'tea' }, { hanzi: '水', english: 'water' }] });
    const lines = formatLessonDiff(diffLessonSpecs(base(), b));
    expect(lines).toEqual([
      'title: "Ordering coffee" → "New"',
      'Section 1, exercise 3: added match pairs "茶 · 水"',
    ]);
  });
});
