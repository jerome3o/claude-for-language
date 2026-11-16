import { describe, expect, it } from 'vitest';
import { clipUtterances } from '../clips/timeline';
import { ALL_STRUCTURES_NOTE } from './__fixtures__/structures';
import { structureNoteView } from './pattern';
import { introLitPart, patternIntroClip, patternIntroLines, patternIntroTexts, spokenPatternName, templateIntroLines } from './patternIntro';
import { SAMPLE_LESSONS } from './samples';
import { exerciseTtsTexts, type NoteExercise } from './types';
import { validateLessonSpec } from './validate';

const parsed = structureNoteView(ALL_STRUCTURES_NOTE)!;
const sampleNote = SAMPLE_LESSONS.find((l) => l.id === 'note')!.spec.sections[0].exercises[0] as NoteExercise;
const sample = structureNoteView(sampleNote)!;

describe('the intro voice-over', () => {
  it('a structure with no intro gets the simple-Chinese template, naming the structure', () => {
    expect(spokenPatternName(parsed.cards[0])).toBe('除了……还……');
    expect(templateIntroLines(parsed.cards[0])).toEqual([
      { zh: '今天我们学一个新句型：“除了……还……”。', en: "Today's new structure: 除了…还…" },
      { zh: '我们先看看这个句型。', en: 'First, the pattern — besides A, also B' },
      { zh: '我们听一个例子。', en: "Let's hear an example." },
      { zh: '现在你也试一试吧！', en: 'Now you try!' },
    ]);
  });
  it('an authored intro wins (cleaned, at most six lines)', () => {
    expect(patternIntroLines(sample.cards[0]).map((l) => l.zh)).toEqual([
      '今天我们学“把”字句。', '先说人，再说“把”和东西。', '我们听一个例子。', '再听一个例子。', '现在你也试一试吧！',
    ]);
  });
});

describe('the intro clip', () => {
  it('title → the pattern building up → each example → the closing line', () => {
    const clip = patternIntroClip(sample.cards[0]);
    expect(clip.scenes.map((s) => s.layout)).toEqual(['title', 'pattern', 'pattern', 'pattern', 'title']);
    expect(clip.scenes.map((s) => s.voice?.text)).toEqual(['今天我们学“把”字句。', '先说人，再说“把”和东西。', '我们听一个例子。', '再听一个例子。', '现在你也试一试吧！']);
    const ex = clip.scenes[2];
    if (ex.layout !== 'pattern') throw new Error('pattern');
    expect(ex.pattern.example?.hanzi).toBe('我把作业做完了。');
    expect(ex.pattern.example?.parts?.find((p) => p.piece === 1)?.text).toBe('把');
    // Each example scene says its line, then reads the example (the parts light up on that read).
    expect(clipUtterances(clip).map((u) => u.text)).toEqual([
      '今天我们学“把”字句。', '先说人，再说“把”和东西。', '我们听一个例子。', '我把作业做完了。', '再听一个例子。', '请把门关上。', '现在你也试一试吧！',
    ]);
    expect(clip.words.map((w) => w.hanzi)).toEqual(['把']);
  });
  it('an older lesson\'s parsed structure gets an intro too', () => {
    const clip = patternIntroClip(parsed.cards[4]);
    expect(clip.scenes.map((s) => s.layout)).toEqual(['title', 'pattern', 'pattern', 'title']);
    expect(clipUtterances(clip).map((u) => u.text)).toContain('咖啡馆里热闹起来了。');
  });
  it('every intro line is prefetched with the lesson (exerciseTtsTexts)', () => {
    const texts = exerciseTtsTexts(ALL_STRUCTURES_NOTE);
    for (const t of patternIntroTexts(parsed)) expect(texts).toContain(t);
    expect(texts).toContain('今天我们学一个新句型：“除了……还……”。');
  });
  it('lights the example\'s parts in turn as it is read', () => {
    const parts = sample.cards[0].examples[0].parts; // 我 · 把 · 作业 · 做 · 完了 · 。
    expect(introLitPart(parts, 0, 3000)).toBe(-1);
    const seen = [500, 1000, 1500, 2000, 2600].map((ms) => introLitPart(parts, ms, 3000));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen[seen.length - 1]).toBe(4);
  });
});

describe('validation', () => {
  it('checks "intro"', () => {
    const spec = (intro: unknown) => ({ title: 't', sections: [{ exercises: [{ type: 'note', patterns: [{ pieces: [{ hanzi: '好' }, { slot: 'Verb' }], intro }] }] }] });
    expect(validateLessonSpec(spec([{ zh: '今天学好。', en: 'Today: 好.' }]))).toEqual([]);
    const bad = ['sections[0].exercises[0].patterns[0]: "intro" must be 1-6 lines {zh, en?} (simple Chinese, read aloud)'];
    expect(validateLessonSpec(spec([]))).toEqual(bad);
    expect(validateLessonSpec(spec([{ zh: '' }]))).toEqual(bad);
    expect(validateLessonSpec(spec(Array.from({ length: 7 }, () => ({ zh: '好' }))))).toEqual(bad);
  });
});
