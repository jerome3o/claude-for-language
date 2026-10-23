/**
 * Claude's check of a free-speaking answer (shared/lesson/answerCheck.ts — speaking — and
 * shared/lesson/speakingTake.ts): which answers get it, the speaking cache text,
 * normalizeAnswerCheck over speaking replies (cleaned, parts, fixes, ≤ 4 tips), the cleaner
 * version, the task's numbered parts, the part marks, the quick questions and the take numbers.
 * Writes lesson-speaking-check.json; checked by core/…/LessonSpeakingCheckParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  answerCheckApplies, answerCheckCacheText, askQuickQuestions, cleanerVersion, normalizeAnswerCheck,
  speakingPartMark, speakingTaskParts, answerCheckChip, ANSWER_CHECK_PART_STATUSES, ANSWER_CHECK_VERDICTS,
} from '../../../shared/lesson/answerCheck';
import {
  speakingClock, speakingTakeLine, SPEAKING_FINISH_TIMEOUT_MS, SPEAKING_LIVE_KEY_MARGIN_MS, SPEAKING_MAX_SECONDS,
} from '../../../shared/lesson/speakingTake';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const ANNIE = "A new colleague, Annie, arrives at your office. Guess who she is (① 就是…吧), tell her where two places are (② 就在), what today's meeting is about (③ 是关于…的), and how busy the team is (④ 形容词 + 到…).";
const SAID = '嗯，你好，你就是……sorry，你就是新来的Annie吧？洗手间在……wait，洗手间就在电梯的旁边。今天的会议是关于下个月的活动。';

const applies = ['oral_expression', 'speak', 'translate', 'note'].flatMap((type) =>
  [SAID, 'sorry, wait', '', null, '嗯'].map((answer) => ({ type, answer, applies: answerCheckApplies(type, answer) })));

const cacheInputs = [
  { prompt_en: ANNIE, model_answer: '', answer: SAID, exercise_type: 'oral_expression', input: 'spoken' },
  { prompt_en: ` ${ANNIE.toUpperCase()} `, model_answer: '你就是Annie吧？', answer: SAID.replace(/[，。？]/g, ' '), exercise_type: 'oral_expression', input: 'spoken', focus: ' At the OFFICE ', hints: ['就是', '  就在 ', '', '关于'], question_audio: '她是谁？' },
  { prompt_en: 'Order two coffees.', model_answer: '我要两杯咖啡。', answer: '我要两杯咖啡', exercise_type: 'speak', input: 'spoken' },
];
const cacheTexts = cacheInputs.map((input) => ({ input, text: answerCheckCacheText(input) }));


const base = {
  verdict: 'acceptable', headline: ' All four parts — close 是关于…的 with 的. ',
  cleaned: '你好，你就是新来的Annie吧？洗手间就在电梯的旁边。今天的会议是关于下个月的活动。',
  cleaned_pinyin: 'nǐ hǎo, nǐ jiù shì xīn lái de Annie ba?',
  corrected: '你好，你就是新来的Annie吧？洗手间就在电梯旁边。今天的会议是关于下个月的活动的。',
  corrected_pinyin: 'nǐ hǎo …',
  parts: [
    { label: '① 就是…吧', status: 'used', note: '你就是新来的Annie吧' },
    { label: '③ 是关于…的', status: 'used_with_issue', note: '' },
    { label: 'x', status: 'great' },
    { status: 'missing' },
    'nope',
    { label: '④ 形容词 + 到…', status: 'missing', note: 'n'.repeat(200) },
  ],
  tips: [1, 2, 3, 4, 5].map((n) => ({ text: `tip ${n}`, quote: '是关于下个月的活动', fix: n === 1 ? '是关于下个月的活动的' : n === 2 ? '是关于下个月的活动' : n === 3 ? 'english' : '的', fix_pinyin: n === 1 ? 'de' : '' })),
};
const raws: unknown[] = [
  base,
  { ...base, verdict: 'correct' },
  { ...base, corrected: base.cleaned },
  { ...base, corrected: SAID },
  { ...base, cleaned: '' },
  { ...base, cleaned: 'english only' },
  { ...base, verdict: 'almost', parts: 'none', tips: [] },
  { ...base, parts: Array.from({ length: 12 }, (_, i) => ({ label: `p${i}`, status: 'used' })) },
];
const normalized = raws.map((raw) => {
  const check = normalizeAnswerCheck(raw, SAID);
  return { raw, answer: SAID, check, cleaner: cleanerVersion(check) };
});

const prompts = [
  ANNIE,
  'Talk about your weekend: ① 先…然后… ② 因为…所以… and ③ 一边…一边…',
  'Describe your favourite restaurant.',
  '',
  'Use (① 虽然…但是…) and （② 越来越） in one story. Then ③ say goodbye',
  '① ① twice ②',
  'Tell me (①',
];
const parts = prompts.map((prompt) => ({ prompt, parts: speakingTaskParts(prompt) }));

writeFileSync(join(OUT, 'lesson-speaking-check.json'), JSON.stringify({
  applies,
  cacheTexts,
  normalized,
  parts,
  chips: ANSWER_CHECK_VERDICTS.map((v) => ({ verdict: v, chip: answerCheckChip(v, true) })),
  marks: ANSWER_CHECK_PART_STATUSES.map((status) => ({ status, mark: speakingPartMark(status) })),
  quick: ['oral_expression', 'speak', 'translate', null].map((type) => ({ type, questions: askQuickQuestions('almost', type) })),
  take: {
    maxSeconds: SPEAKING_MAX_SECONDS,
    keyMarginMs: SPEAKING_LIVE_KEY_MARGIN_MS,
    finishTimeoutMs: SPEAKING_FINISH_TIMEOUT_MS,
    lines: (['recording', 'transcribing', 'offline', 'failed'] as const).map((phase) => ({ phase, line: speakingTakeLine(phase) })),
    clocks: [0, 5, 59, 60, 65, 300, -3, 3599.9].map((s) => ({ s, clock: speakingClock(s) })),
  },
}, null, 1));
