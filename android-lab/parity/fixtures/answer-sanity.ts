/**
 * The answer screen's sanity rules (Jerome, Nov 2026: "✓ Also right — …but 因为 clause should come before the subject"
 * when his answer already put it first, with a tip comparing two identical strings and 我 painted red on a pure
 * reordering): normalizeAnswerCheck with the model answer (insaneTip / saneHeadline, shared/lesson/answerCheck.ts),
 * comparesIdenticalTexts, recommendsText, and answerMarks / sameCharacters (shared/lesson/feedback.ts). Writes
 * answer-sanity.json; checked by core/…/AnswerSanityParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  comparesIdenticalTexts, normalizeAnswerCheck, recommendsText, ANSWER_CHECK_VERSION, PLAIN_ACCEPTABLE_HEADLINE, PLAIN_CORRECT_HEADLINE,
} from '../../../shared/lesson/answerCheck';
import { answerMarks, sameCharacters, REORDERED_NOTE } from '../../../shared/lesson/feedback';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const answer = '因为这个问题，我睡不着觉。';
const model = '我因为这个问题睡不着觉。';
const selfCompare = '因为 (reason) typically comes before the subject, then the consequence. 因为这个问题 我睡不着觉 reads more naturally than 因为这个问题 我睡不着觉.';

const raws: Array<{ raw: unknown; answer: string; model: string | null }> = [
  { raw: { verdict: 'acceptable', headline: 'Correct meaning, but 因为 clause should come before the subject in formal style.', corrected: '', tips: [{ text: selfCompare, quote: '因为' }] }, answer, model },
  { raw: { verdict: 'acceptable', headline: 'Correct meaning, but 因为 clause should come before the subject in formal style.', corrected: '', tips: [{ text: selfCompare, quote: '因为' }] }, answer, model: null },
  { raw: { verdict: 'almost', headline: 'Fix the order.', corrected: '我因为这个问题睡不着。', tips: [{ text: selfCompare }, { text: 'Use 因为这个问题，我睡不着觉 here.' }, { text: '睡不着觉 is fine; 睡不着 alone also works.', quote: '睡不着觉' }] }, answer, model },
  { raw: { verdict: 'correct', headline: 'Correct, but try 再.', tips: [{ text: 'You could add 再 for emphasis.', quote: '再' }] }, answer: model, model },
  { raw: { verdict: 'correct', headline: 'Correct and natural — 很 is optional here.', tips: [{ text: '很 is optional inside a 即使 clause; 即使再便宜 stresses it.', quote: '即使便宜' }] }, answer: '即使便宜，我也不买。', model: '即使很便宜，我也不买。' },
  { raw: { verdict: 'acceptable', headline: 'Right, but 觉 is optional.', tips: [{ text: '因为这个问题，我睡不着觉 is natural.' }, { text: '睡不着 alone is enough; 觉 is optional.', quote: '睡不着觉' }] }, answer, model },
  { raw: { verdict: 'correct', headline: '因为这个问题我睡不着觉 is better than 因为这个问题，我睡不着觉.', tips: [] }, answer, model },
  { raw: { verdict: 'acceptable', headline: 'Fine — 因为这个问题，我睡不着觉 sounds more natural.', tips: [] }, answer, model },
  { raw: { verdict: 'wrong', headline: 'However, the meaning is lost.', tips: [{ text: 'Say 我因为这个问题睡不着觉 instead (VS 因为问题).' }] }, answer: '这个问题我很好', model },
  { raw: { verdict: 'acceptable', headline: 'Good, but… Butter.', tips: [{ text: 'Nothing to add — ok' }] }, answer, model },
  // Free speaking: a tip whose better version IS the whole transcript goes.
  { raw: { verdict: 'acceptable', headline: 'Clear, though shorter is fine.', cleaned: '你好，我是安妮。', corrected: '', tips: [{ text: 'Fine.', quote: '你好', fix: '你好，我是安妮' }] }, answer: '你好，我是安妮。', model: '你好！' },
];
const normalized = raws.map((c) => ({ ...c, check: normalizeAnswerCheck(c.raw, c.answer, c.model) }));

const lines = [
  selfCompare,
  '因为这个问题 我睡不着觉 reads more naturally than 因为这个问题，我睡不着觉.',
  '也不着急 is a statement; use 也别着急 instead.',
  '和 links nouns, not 和 actions',
  'Say 你好 — 你好 is fine',
  'notable: 你好 你好',
  '你好 vs 你好',
  'Say 因为这个问题，我睡不着觉 instead.',
  '→ 因为这个问题，我睡不着觉',
  '因为这个问题，我睡不着觉 sounds more natural.',
  '“因为这个问题，我睡不着觉” IS BETTER.',
  'Say 我因为这个问题睡不着觉 instead.',
  'reuse 因为这个问题，我睡不着觉',
  '因为这个问题，我睡不着觉 is morenatural',
];
const mine = '因为这个问题我睡不着觉';
const texts = lines.map((text) => ({ text, compares: comparesIdenticalTexts(text), recommends: recommendsText(text, mine) }));

const PAIRS: Array<[string, string]> = [
  [answer, model], ['这个问题让我睡不着。', model], ['我因为这个问题睡不着觉', model], ['', model], ['。', model],
  ['我我', '我'], ['好𠀀啊', '𠀀啊好！'], ['ＡＢＣ我们', 'abc 我们。'], ['你好', ''],
];
const VERDICTS = [null, 'correct', 'acceptable', 'almost', 'wrong'];
const marks = PAIRS.flatMap(([a, m]) => VERDICTS.map((v) => ({ answer: a, model: m, verdict: v, same: sameCharacters(a, m), marks: answerMarks(a, m, v) })));

writeFileSync(join(OUT, 'answer-sanity.json'), JSON.stringify({
  version: ANSWER_CHECK_VERSION,
  plain: { correct: PLAIN_CORRECT_HEADLINE, acceptable: PLAIN_ACCEPTABLE_HEADLINE, reordered: REORDERED_NOTE },
  normalized,
  texts,
  mine,
  marks,
}, null, 1));
