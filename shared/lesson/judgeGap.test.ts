import { describe, expect, it } from 'vitest';
import { validateLessonSpec } from './validate';
import { exercisePoints, fillGap, gapCount, gapItemOptions, gapParts, judgeSpokenText, isScoreable, type CustomLessonSpec, type LessonExercise } from './types';
import { allAnswered, gapFeedback, gapOptionsFor, gapResults, itemsScoreLine, judgeFeedback, judgeResults } from './judgeGap';
import { partPoints, sanitizeAttemptData } from './attempt';
import { lessonToMarkdown, lessonVocabRows } from './export';
import { SAMPLE_LESSONS } from './samples';
import { advanceRun, lessonSteps, NEW_RUN, verdictWrong } from '../study/lessonRun';

function lesson(...exercises: LessonExercise[]): CustomLessonSpec {
  return { title: 'Test', sections: [{ exercises }] };
}

const judgeSample = SAMPLE_LESSONS.find(s => s.id === 'judge')!.spec.sections[0].exercises[0];
const gapSample = SAMPLE_LESSONS.find(s => s.id === 'gap_choice')!.spec.sections[0].exercises;
if (judgeSample.type !== 'judge' || gapSample[0].type !== 'gap_choice' || gapSample[1].type !== 'gap_choice') throw new Error('samples changed');
const judge = judgeSample;
const gap = gapSample[0];
const ownWords = gapSample[1];

describe('the gap marker', () => {
  it('counts gaps (two or more underscores)', () => {
    expect(gapCount('他___走。')).toBe(1);
    expect(gapCount('他__走。')).toBe(1);
    expect(gapCount('他_走。')).toBe(0);
    expect(gapCount('___，___。')).toBe(2);
    expect(gapCount('没有空')).toBe(0);
  });
  it('fills the gap with the word — the marker never survives', () => {
    expect(fillGap('他___走。', '刚')).toBe('他刚走。');
    expect(fillGap('______你说什么？', '刚才')).toBe('刚才你说什么？');
    expect(fillGap('明天___来吧。', '$&')).toBe('明天$&来吧。');
    expect(fillGap('没有空', '刚')).toBe('没有空');
    expect(gapParts('我___没听见。')).toEqual({ before: '我', after: '没听见。' });
    expect(gapParts('没有空')).toEqual({ before: '没有空', after: '' });
  });
  it('per-sentence options override the shared ones', () => {
    expect(gapItemOptions(gap, gap.items[0])).toEqual(['刚', '刚才']);
    expect(gapItemOptions(ownWords, ownWords.items[1])).toEqual(['的', '得', '地']);
    expect(gapOptionsFor(ownWords, 0)).toEqual(['再', '在']);
    expect(gapOptionsFor(ownWords, 9)).toEqual([]);
  });
});

describe('validateLessonSpec — judge', () => {
  const ok = (correct: boolean, extra: object = {}) => ({ hanzi: '我吃了饭。', correct, ...extra });
  const wrong = { hanzi: '我了吃饭。', correct: false, correction: { hanzi: '我吃饭了。' }, explanation: '了 after the verb.' };
  it('accepts the sample and a minimal one', () => {
    expect(validateLessonSpec(lesson(judge))).toEqual([]);
    expect(validateLessonSpec(lesson({ type: 'judge', sentences: [ok(true), wrong, ok(true)] }))).toEqual([]);
  });
  it('needs 3-8 sentences', () => {
    expect(validateLessonSpec(lesson({ type: 'judge', sentences: [ok(true), wrong] }))[0]).toMatch(/3-8 sentences/);
    expect(validateLessonSpec(lesson({ type: 'judge', sentences: Array.from({ length: 9 }, () => ok(true)) }))[0]).toMatch(/3-8 sentences/);
  });
  it('a wrong sentence needs its correction (different) and why', () => {
    const errs = validateLessonSpec(lesson({ type: 'judge', sentences: [ok(true), ok(true), { hanzi: '我了吃饭。', correct: false }] }));
    expect(errs).toEqual([
      'sections[0].exercises[0].sentences[2]: an incorrect sentence needs "correction": {hanzi, pinyin?, english?} (the right version)',
      'sections[0].exercises[0].sentences[2]: an incorrect sentence needs "explanation" (one line: why it is wrong)',
    ]);
    const same = { ...wrong, correction: { hanzi: '我了 吃饭' } };
    expect(validateLessonSpec(lesson({ type: 'judge', sentences: [ok(true), ok(true), same] }))[0]).toMatch(/must differ/);
  });
  it('"correct" must be a boolean; a right sentence takes no correction', () => {
    expect(validateLessonSpec(lesson({ type: 'judge', sentences: [ok(true), ok(true), { hanzi: '好', correct: 'yes' }] } as never))[0]).toMatch(/"correct" must be true/);
    expect(validateLessonSpec(lesson({ type: 'judge', sentences: [ok(true), ok(true), ok(true, { correction: { hanzi: '好' } })] }))[0]).toMatch(/takes no "correction"/);
  });
});

describe('validateLessonSpec — gap_choice', () => {
  it('accepts shared options and per-sentence options', () => {
    expect(validateLessonSpec(lesson(gap, ownWords))).toEqual([]);
  });
  it('needs exactly one gap per sentence', () => {
    const errs = validateLessonSpec(lesson({ type: 'gap_choice', options: ['刚', '刚才'], items: [{ sentence: '他刚走。', answer: '刚' }, { sentence: '___，___', answer: '刚' }] }));
    expect(errs).toEqual([
      'sections[0].exercises[0].items[0]: "sentence" must contain exactly one gap "___" (found 0)',
      'sections[0].exercises[0].items[1]: "sentence" must contain exactly one gap "___" (found 2)',
    ]);
  });
  it('the answer must be one of the options; 2-4 different options', () => {
    expect(validateLessonSpec(lesson({ type: 'gap_choice', options: ['刚', '刚才'], items: [{ sentence: '他___走。', answer: '才' }, { sentence: '他___走。', answer: '刚' }] }))[0])
      .toBe('sections[0].exercises[0].items[0]: "answer" "才" must be one of the options (刚 / 刚才)');
    expect(validateLessonSpec(lesson({ type: 'gap_choice', options: ['刚'], items: [{ sentence: '他___走。', answer: '刚' }, { sentence: '他___走。', answer: '刚' }] }))[0]).toMatch(/2-4 different words/);
    expect(validateLessonSpec(lesson({ type: 'gap_choice', options: ['刚', '刚'], items: [{ sentence: '他___走。', answer: '刚' }, { sentence: '他___走。', answer: '刚' }] }))[0]).toMatch(/2-4 different words/);
    expect(validateLessonSpec(lesson({ type: 'gap_choice', items: [{ sentence: '他___走。', answer: '刚' }, { sentence: '他___走。', answer: '刚', options: ['刚', '才'] }] }))[0])
      .toMatch(/no options — give "options" on the exercise/);
  });
  it('needs 2-8 sentences and an answer', () => {
    expect(validateLessonSpec(lesson({ type: 'gap_choice', options: ['a', 'b'], items: [{ sentence: '___', answer: 'a' }] }))[0]).toMatch(/2-8 sentences/);
    expect(validateLessonSpec(lesson({ type: 'gap_choice', options: ['a', 'b'], items: [{ sentence: '___', answer: '' }, { sentence: '___', answer: 'a' }] }))[0]).toMatch(/needs "answer"/);
  });
});

describe('checking (offline, no model)', () => {
  it('judges each sentence against the author’s verdict', () => {
    // Sample: right, wrong, right, wrong, right.
    const res = judgeResults(judge, [true, false, false, true, null]);
    expect(res).toEqual([true, true, false, false, null]);
    expect(allAnswered(res)).toBe(false);
    expect(allAnswered(judgeResults(judge, [true, true, true, true, true]))).toBe(true);
    expect(judgeFeedback(true, true)).toBe('✓ Right — this sentence is correct');
    expect(judgeFeedback(false, false)).toBe('✗ Not quite — this sentence has a mistake');
  });
  it('marks each gap pick', () => {
    expect(gapResults(gap, ['刚才', '刚才', null, ' 刚 '])).toEqual([true, false, null, true]);
    expect(gapFeedback('刚', '刚')).toBe('✓ 刚');
    expect(gapFeedback('刚', '刚才')).toBe('✗ You chose 刚才 — it’s 刚');
    expect(gapFeedback('刚', null)).toBe('✗ It’s 刚');
  });
  it('says the score per sentence', () => {
    expect(itemsScoreLine([true, true, true])).toBe('✓ All 3 right');
    expect(itemsScoreLine([true, false, true])).toBe('2 of 3 right');
    expect(itemsScoreLine([true])).toBe('✓ Right');
  });
  it('never speaks a mistake', () => {
    expect(judge.sentences.map(judgeSpokenText)).toEqual(['我昨天买了一本书。', '他去北京了。', '我已经吃饭了。', '我每天喝咖啡。', '她买了三个苹果。']);
    expect(judgeSpokenText({ hanzi: '错', correct: false })).toBe('');
  });
});

describe('scoring, the retry round and the attempt', () => {
  it('scores one point per sentence', () => {
    expect(isScoreable(judge)).toBe(true);
    expect(exercisePoints(judge)).toBe(5);
    expect(exercisePoints(gap)).toBe(4);
  });
  it('one wrong sentence = the exercise is owed in the retry round', () => {
    const answer = { items: [{ judged: true, correct: true }, { judged: true, correct: false }, { judged: true, correct: true }, { judged: false, correct: true }, { judged: true, correct: true }] };
    expect(partPoints(answer)).toBe(4);
    expect(verdictWrong(false, 4, 5)).toBe(true);
    const steps = lessonSteps(lesson(judge));
    expect(advanceRun(NEW_RUN, steps, false).owed).toEqual(['s0e0']);
  });
  it('keeps the per-sentence answers through the server sanitizer', () => {
    const clean = sanitizeAttemptData({
      exercises: [
        { section: 0, index: 0, type: 'judge', correct: false, points: 4, max_points: 5, answer: { items: [{ judged: true, correct: true, x: 1 }, { judged: 'no', correct: 'maybe' }] } },
        { section: 0, index: 1, type: 'gap_choice', correct: true, points: 2, max_points: 2, answer: { items: [{ pick: '刚'.repeat(30), correct: true }] } },
      ],
    })!;
    expect(clean.exercises[0].answer!.items).toEqual([{ judged: true, correct: true }, { correct: null }]);
    expect(clean.exercises[1].answer!.items![0].pick).toHaveLength(20);
  });
});

describe('exports', () => {
  it('Markdown has the sentences to judge / fill and an answer key with the corrections', () => {
    const md = lessonToMarkdown(lesson(judge, gap));
    expect(md).toContain('2) 他了去北京。   ✓ / ✗');
    expect(md).toContain('2) ✗ → 他去北京了。 (了 comes after the verb or at the end of the sentence — never before the verb.)');
    expect(md).toContain('Words: 刚 · 刚才');
    expect(md).toContain('2) 刚 — 他刚来北京两个月。');
    expect(md).not.toMatch(/2\) 刚 — .*___/);
  });
  it('vocabulary rows never carry a mistake or a gap', () => {
    const rows = lessonVocabRows(lesson(judge, gap));
    const terms = rows.map(r => r.term);
    expect(terms).toContain('他去北京了。');
    expect(terms).not.toContain('他了去北京。');
    expect(terms).toContain('我刚到家，就下雨了。');
    expect(terms.some(t => t.includes('_'))).toBe(false);
  });
});
