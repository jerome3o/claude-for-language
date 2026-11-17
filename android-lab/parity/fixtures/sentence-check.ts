/**
 * Golden vectors for sentence_making's honest grade (shared/lesson/sentenceCheck.ts) and "a pause is never grammar"
 * (shared/cards/answer.ts `scrubSpokenTranscript`, shared/lesson/answerCheck.ts `punctuationComplaint` + the spoken
 * normalise): the coherence guard, the view of v1 / v2 checks, the line cut, the scrub of spoken takes, and an answer
 * check's punctuation-only lines dropped on a spoken answer. Writes sentence-check.json; checked by
 * core/…/SentenceCheckParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  explanationClauses, guardSentenceGrade, legacyGrade, namesProblem, needsWorkHeadline, problemClause, sentenceCheckView, sentenceGradeChip,
  sentenceLine, targetWordsPhrase, SENTENCE_GRADES,
  SENTENCE_TRY_AGAIN_LABEL, SENTENCE_SHOW_FIX_LABEL, SENTENCE_FIX_LABEL, SENTENCE_SAY_FIX_LABEL, SENTENCE_MORE_LABEL, SENTENCE_EXAMPLE_TOGGLE,
  SENTENCE_FIXING_LINE, SENTENCE_FIX_OFFLINE, SENTENCE_FIX_FAILED, SENTENCE_RETRY_OFFLINE, SENTENCE_RETRY_NOTE, SENTENCE_SELF_CHECK,
  SENTENCE_SELF_CHECK_HANDWRITTEN, SENTENCE_RIGHT_HEADLINE, SENTENCE_MISSING_WORD_HEADLINE, SENTENCE_WRONG_HEADLINE,
  SENTENCE_CHECK_VERSION, SENTENCE_FIX_VERSION, type SentenceFeedback,
} from '../../../shared/lesson/sentenceCheck';
import { scrubSpokenTranscript, spokenCheckAnswer } from '../../../shared/cards/answer';
import { normalizeAnswerCheck, punctuationComplaint, ANSWER_CHECK_VERSION, SPEAKING_CHECK_VERSION } from '../../../shared/lesson/answerCheck';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: sentence-check <out-dir>');
mkdirSync(OUT, { recursive: true });

const JEROME = 'Good use of 本来…要 to set up the original plan; but the second clause just states another plan rather than an actual interrupting event, so it should show what really happened, e.g. with 结果 or 可是…了. Also 健身馆 is usually 健身房.';

const LINES = [
  JEROME, 'Natural and correct', 'Nothing to fix — nicely done.', 'No mistakes here.', 'Good, but 健身馆 is usually 健身房.',
  'It should say what happened.', 'A little unnatural.', 'The second half doesn’t follow.', 'Can’t fault it.', 'Not wrong, just plain.',
  'Better: 可是.', 'This doesn\'t follow.', 'Use 有没有, not 有不有.', '', '本来…要 used naturally', 'Rather than 但是, use 可是.',
  'Missing 了 at the end.', 'Butter is not a problem.', 'Nice. However, 要 is optional.', 'Great sentence!  Very natural.',
];

const WORDS: string[][] = [['本来', '要'], ['不知道', '有没有'], ['a', 'b', 'c', 'd'], [], ['想']];

const FEEDBACKS: SentenceFeedback[] = [
  { verdict: 'correct', uses_all_words: true, comment: JEROME },
  { verdict: 'correct', uses_all_words: true, comment: 'Nice — that sentence works.' },
  { verdict: 'minor', uses_all_words: true, comment: '换 not 变.' },
  { verdict: 'minor', uses_all_words: false, comment: 'Add 所以.' },
  { verdict: 'incorrect', uses_all_words: true, comment: '' },
  { verdict: 'correct', grade: 'right', headline: 'Natural and correct', reason: JEROME, fixable: false, uses_all_words: true, comment: '' },
  { verdict: 'correct', grade: 'right', headline: '本来…要 used naturally', reason: 'It sets up the plan, and 可是 shows what changed.', fixable: false, uses_all_words: true, comment: '' },
  { verdict: 'minor', grade: 'needs_work', headline: '本来…要 used right — the second half doesn’t follow', reason: '但是我学中文 states another plan; say what actually happened instead.', more: '健身馆 is usually 健身房.', fixable: true, uses_all_words: true, comment: '' },
  { verdict: 'minor', grade: 'needs_work', headline: '', reason: '', fixable: undefined, uses_all_words: true, comment: '' },
  { verdict: 'incorrect', grade: 'wrong', headline: '所以 is missing', reason: 'Use every target word.', fixable: true, uses_all_words: false, comment: '' },
  { verdict: 'correct', grade: 'right', headline: 'Natural', reason: 'Natural', more: 'Natural', fixable: false, uses_all_words: true, comment: '' },
  { verdict: 'correct', grade: 'right', headline: 'Great', reason: 'All fine. And 想 is used well.', more: 'Also, 去 is usually dropped here.', uses_all_words: true, comment: '' },
  { verdict: 'correct', grade: 'bogus' as never, headline: 'x', uses_all_words: true, comment: 'y' },
];

const views = FEEDBACKS.flatMap((f) => WORDS.map((words) => ({ feedback: f, words, view: sentenceCheckView(f, words) })));
const guard = SENTENCE_GRADES.flatMap((g) => [true, false].flatMap((u) => [[], ['Nice.'], ['Nice.', 'Also 健身馆 is usually 健身房.'], [JEROME]].map((lines) => ({ grade: g, uses: u, lines, out: guardSentenceGrade(g, lines, u) }))));
const legacy = ['correct', 'minor', 'incorrect', 'x', null].flatMap((v) => [true, false].map((u) => ({ verdict: v, uses: u, out: legacyGrade(v, u) })));
const lineCuts = [...LINES, 'The second clause just states another plan rather than an actual interrupting event, so it should show what really happened.', 'x'.repeat(130), 'word '.repeat(40), '一二三。四五六', ' a   b  c ']
  .flatMap((t) => [110, 30, 12].map((max) => ({ text: t, max, out: sentenceLine(t, max) })));

const SPOKEN = [
  '我不知道。 我妹妹有，不有新电脑。', '我有 3.5 块，好吗？', '我喜欢 coffee，你呢？', "I don't know, maybe.", '他说"好"。', '这个牛角包 3块多元',
  '  ', '虾饺我最喜欢的。 点心。', '你好…  我是 Jerome。', '嗯，那个，就是… 我想去。', '一、二、三', '他说：“你好！”', '3 个人', '我　们',
];
const scrub = SPOKEN.map((t) => ({ text: t, out: scrubSpokenTranscript(t), spoken: spokenCheckAnswer(t, 'spoken'), edited: spokenCheckAnswer(t, 'edited'), typed: spokenCheckAnswer(t, 'typed') }));

const COMPLAINTS = [
  'Don\'t split it into separate sentences.', 'Splitting into separate sentences breaks the question.', 'A run-on sentence.', 'Missing a comma.',
  '有不有 → 有没有', '。 → ，', 'Use a period here.', 'The fragment 我妹妹 needs a verb.', 'Use 有没有 for yes-no.', 'Nice!', 'Splits 有没有 apart.',
];
const complaints = COMPLAINTS.map((t) => ({ text: t, out: punctuationComplaint(t) }));

const RAW = {
  verdict: 'almost', headline: 'Don\'t split it into separate sentences.', corrected: '我不知道我妹妹有没有新电脑。',
  tips: [{ text: 'Splitting into separate sentences breaks the question.' }, { text: '有不有 is not a question form — use 有没有.', quote: '有不有' }],
};
const RAW_GOOD = { verdict: 'correct', headline: 'Right — though the comma splits it.', corrected: '', tips: [{ text: 'A pause is fine; no full stop needed.' }] };
const normalized = [RAW, RAW_GOOD].flatMap((raw) => [true, false].map((spoken) => ({
  raw, answer: '我不知道我妹妹有不有新电脑', model: '我不知道我妹妹有没有新电脑。', spoken,
  check: normalizeAnswerCheck(raw, '我不知道我妹妹有不有新电脑', '我不知道我妹妹有没有新电脑。', spoken),
})));

writeFileSync(join(OUT, 'sentence-check.json'), JSON.stringify({
  versions: { check: SENTENCE_CHECK_VERSION, fix: SENTENCE_FIX_VERSION, answer: ANSWER_CHECK_VERSION, speaking: SPEAKING_CHECK_VERSION },
  copy: {
    tryAgain: SENTENCE_TRY_AGAIN_LABEL, showFix: SENTENCE_SHOW_FIX_LABEL, fixLabel: SENTENCE_FIX_LABEL, sayFix: SENTENCE_SAY_FIX_LABEL,
    more: SENTENCE_MORE_LABEL, example: SENTENCE_EXAMPLE_TOGGLE, fixing: SENTENCE_FIXING_LINE, fixOffline: SENTENCE_FIX_OFFLINE,
    fixFailed: SENTENCE_FIX_FAILED, retryOffline: SENTENCE_RETRY_OFFLINE, retryNote: SENTENCE_RETRY_NOTE, selfCheck: SENTENCE_SELF_CHECK,
    selfCheckHandwritten: SENTENCE_SELF_CHECK_HANDWRITTEN, right: SENTENCE_RIGHT_HEADLINE, missing: SENTENCE_MISSING_WORD_HEADLINE, wrong: SENTENCE_WRONG_HEADLINE,
  },
  chips: SENTENCE_GRADES.map((g) => ({ grade: g, ...sentenceGradeChip(g) })),
  phrases: WORDS.map((w) => ({ words: w, phrase: targetWordsPhrase(w), headline: needsWorkHeadline(w) })),
  problems: LINES.map((t) => ({ text: t, names: namesProblem(t), clause: problemClause(t), clauses: explanationClauses(t) })),
  guard, legacy, lineCuts, views, scrub, complaints, normalized,
}, null, 1));
