/**
 * Golden vectors for the per-sentence lesson exercises (shared/lesson/judgeGap.ts + the gap helpers
 * of shared/lesson/types.ts): the gap marker (gapCount / gapParts / fillGap), per-sentence checking
 * (judgeResults / gapResults over random answers), the feedback lines, the score line, what a judge
 * sentence speaks, points per exercise and partPoints. Writes lesson-judge-gap.json; checked by
 * core/…/JudgeGapParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { exercisePoints, fillGap, gapCount, gapItemOptions, gapParts, judgeSpokenText, type GapChoiceExerciseSpec, type JudgeExerciseSpec } from '../../../shared/lesson/types';
import { allAnswered, gapFeedback, gapResults, itemsScoreLine, judgeFeedback, judgeResults } from '../../../shared/lesson/judgeGap';
import { partPoints } from '../../../shared/lesson/attempt';
import { SAMPLE_LESSONS } from '../../../shared/lesson/samples';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: lesson-judge-gap <out-dir>');
mkdirSync(OUT, { recursive: true });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(20261024);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

const SENTENCES = [
  '他___走。', '___你说什么？', '我__没听见。', '他_走。', '没有空', '___，___。', '______', '', '_', '__', '明天 ___ 来吧。',
  '他跑___很快。', '𠀀___𠀁', 'a___b___c', '___', '  ___  ', '刚___才', '___$&',
];
const WORDS = ['刚', '刚才', '', ' 刚 ', '$&', '$1', '得', '𠀀', '___'];
const gap = SENTENCES.flatMap(s => WORDS.map(w => ({ s, w, count: gapCount(s), parts: gapParts(s), filled: fillGap(s, w) })));

const exercises = SAMPLE_LESSONS.flatMap(l => l.spec.sections.flatMap(s => s.exercises));
const judges = exercises.filter((e): e is JudgeExerciseSpec => e.type === 'judge');
const gaps = exercises.filter((e): e is GapChoiceExerciseSpec => e.type === 'gap_choice');

const judge = Array.from({ length: 60 }, () => {
  const ex = pick(judges);
  const judged = ex.sentences.map(() => pick([true, false, null] as const));
  const results = judgeResults(ex, judged);
  return {
    exercise: ex, judged, results, all: allAnswered(results), line: itemsScoreLine(results),
    spoken: ex.sentences.map(judgeSpokenText),
    feedback: ex.sentences.map((s, i) => (results[i] === null ? null : judgeFeedback(s.correct, results[i]!))),
  };
});
const gapChecks = Array.from({ length: 60 }, () => {
  const ex = pick(gaps);
  const picks = ex.items.map(item => pick([...gapItemOptions(ex, item), null, '', ' 刚 ', '别的']));
  const results = gapResults(ex, picks);
  return {
    exercise: ex, picks, results, all: allAnswered(results), line: itemsScoreLine(results),
    options: ex.items.map(item => gapItemOptions(ex, item)),
    feedback: ex.items.map((item, i) => gapFeedback(item.answer, picks[i])),
    filled: ex.items.map(item => fillGap(item.sentence, item.answer)),
  };
});
const lines = [[], [true], [false], [null], [true, true], [true, false, null], [false, false], [true, true, true, true, true, true, true, true]]
  .map(results => ({ results, line: itemsScoreLine(results), all: allAnswered(results) }));
const points = [...judges, ...gaps].map(ex => ({ exercise: ex, points: exercisePoints(ex) }));
const parts = [
  undefined, {}, { items: [] }, { items: [{ correct: true }, { correct: false }, { correct: null }, { correct: true }] },
  { questions: [{ correct: true }], items: [{ correct: true }, { correct: true }] }, { text: 'x' },
].map(answer => ({ answer: answer ?? null, points: partPoints(answer as never) }));

writeFileSync(join(OUT, 'lesson-judge-gap.json'), JSON.stringify({ gap, judge, gapChecks, lines, points, parts }));
