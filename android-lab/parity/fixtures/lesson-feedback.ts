/**
 * Golden vectors for the mini-lesson answer screen's feedback (shared/lesson/feedback.ts): the feel per moment
 * (with / without an earlier celebration), Claude's verdict → moment, 🎤 Say it again's target for every sample
 * exercise (+ hand-made edge cases), and Claude's fix as a second target. Writes lesson-feedback.json; checked
 * by core/…/LessonFeedbackParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  claudeVerdictMoment, lessonFeel, LESSON_FEEL_MOMENTS, sayAgainFix, sayAgainTarget,
  CLAUDE_CHECKING_LINE, SAY_AGAIN_LABEL, SAY_AGAIN_NOTE, SAY_AGAIN_FIX_LABEL, EXAMPLE_LABEL,
} from '../../../shared/lesson/feedback';
import { SAMPLE_LESSONS } from '../../../shared/lesson/samples';
import type { LessonExercise } from '../../../shared/lesson/types';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: lesson-feedback <out-dir>');
mkdirSync(OUT, { recursive: true });

const feel = LESSON_FEEL_MOMENTS.flatMap(m => [false, true].map(c => ({ moment: m, celebrated: c, ...lessonFeel(m, c) })));
const verdicts = ['correct', 'acceptable', 'almost', 'wrong', 'error', '', null].map(v => ({ verdict: v, moment: claudeVerdictMoment(v) }));

const extra: LessonExercise[] = [
  { type: 'scramble', english: 'x', tiles: ['我 ', ' 很好'], correct_order: ['我 ', ' 很好'] },
  { type: 'choice', question: 'q', options: [{ hanzi: 'yes' }, { hanzi: '是', pinyin: ' shì ' }], correct: 1 },
  { type: 'choice', question: 'q', options: [{ hanzi: '是' }], correct: 3 },
  { type: 'translate', english: 'x', reference_hanzi: '  你好。 ', reference_pinyin: '' },
  { type: 'speak', prompt: 'x' },
  { type: 'speak', prompt: 'x', example: { hanzi: 'hello' } },
  { type: 'oral_expression', prompt: 'x', example: { hanzi: '𠀀好', pinyin: 'hǎo' } },
  { type: 'sentence_making', words: [{ hanzi: '怎么' }], example: { hanzi: '你怎么换工作了？' } },
  { type: 'write_handwriting', answer: { hanzi: '谢谢', pinyin: 'xièxie' } },
  { type: 'note', title: 't' },
];
const exercises = [...SAMPLE_LESSONS.flatMap(l => l.spec.sections.flatMap(s => s.exercises)), ...extra];
const targets = exercises.map(exercise => ({ exercise, target: sayAgainTarget(exercise) }));

const FIX = ['你怎么换工作了？', ' 你怎么换工作了 ', '', 'ok', '好。', '你好！', '𠀀'];
const SAID = ['你怎么变工作了？', '你怎么换工作了', '', null, '你好'];
const OFFERED = ['你怎么换工作了', '你怎么搬家了？', '', null, '你好。'];
const fixes = FIX.flatMap(c => SAID.flatMap(s => OFFERED.map(o => ({ corrected: c, said: s, offered: o, fix: sayAgainFix(c, s, o) }))));

writeFileSync(join(OUT, 'lesson-feedback.json'), JSON.stringify({
  copy: { checking: CLAUDE_CHECKING_LINE, label: SAY_AGAIN_LABEL, note: SAY_AGAIN_NOTE, fixLabel: SAY_AGAIN_FIX_LABEL, example: EXAMPLE_LABEL },
  feel, verdicts, targets, fixes,
}, null, 1));
