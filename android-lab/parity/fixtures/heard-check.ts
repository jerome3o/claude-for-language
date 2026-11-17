/**
 * What the ear can't tell (shared/lesson/heardCheck.ts; Jerome, Nov 2026: 她责怪我 answered "He blames me." came back
 * "≈ Nearly · Wrong subject"): heardMeaningKey / the stems, marksTense / hasTaPronoun / taKey, the line rules,
 * sameRolesAndPolarity and forgiveUnheard over normalised checks. Writes heard-check.json; checked by
 * core/…/HeardCheckParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  englishWords, forgiveUnheard, hasTaPronoun, heardMeaningKey, marksTense, pluralStem, sameRolesAndPolarity, taKey, tenseStem,
  unheardPronounLine, unheardTenseLine, HEARD_BOTH_HEADLINE, HEARD_PRONOUN_HEADLINE, HEARD_RIGHT_HEADLINE, HEARD_TA_HEADLINE,
  HEARD_TENSE_HEADLINE, THIRD_PERSON_WORDS, UNHEARD_TENSE_MARKERS,
} from '../../../shared/lesson/heardCheck';
import { normalizeAnswerCheck, ANSWER_CHECK_VERSION, MEANING_CHECK_VERSION, type AnswerCheckInput } from '../../../shared/lesson/answerCheck';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const english = [
  'He blames me.', 'She blamed me.', 'It blamed me', "She's blaming me", 'She is blaming me', 'She has blamed me', 'She will blame me',
  "She didn't blame me", 'She does not blame me', "She won't blame me", 'I blamed her', 'You blamed me', 'She went to the bank',
  'He goes to a bank', 'She is going to the bank', 'She has a dog', 'She is a dog', 'She bought books', 'He buys a book',
  'They’ve stopped the cars', "We'll try it", 'She cannot come', "Tom's dogs ran", 'He hid himself', 'Her book is his',
  'The boxes', 'studies / studied / studying', 'Called, calling, calls', '  ', "She'd added it", 'Ｈｅ ｗｅｎｔ', "ain't",
];
const meaningKeys = english.map((text) => ({
  text,
  words: englishWords(text),
  keys: [[false, false], [true, false], [false, true], [true, true]].map(([pronouns, tense]) => heardMeaningKey(text, { pronouns, tense })),
}));

const words = [
  'blame', 'blames', 'blamed', 'blaming', 'stop', 'stopped', 'stopping', 'make', 'made', 'making', 'try', 'tries', 'tried',
  'call', 'called', 'add', 'added', 'run', 'running', 'ran', 'go', 'goes', 'going', 'went', 'gone', 'boxes', 'watches',
  'glass', 'bus', 'this', 'is', 'was', 'news', 'being', 'eaten', 'hoped', 'hoping', 'studies', 'flies', 'flying', 'ta', 'taself',
];
const stems = words.map((w) => ({ word: w, tense: tenseStem(w), plural: pluralStem(w) }));

const chinese = ['她责怪我。', '他责怪了我', '她明天会责怪我', '她没责怪我', '我责怪你', '它们在吃饭', '牠跑了', '祂来', '她昨天说', '她们去银行', '为了她', '他 3 个', ''];
const zh = chinese.map((text) => ({ text, marks: marksTense(text), ta: hasTaPronoun(text), key: taKey(text) }));

const lineCases: Array<[string, string | null]> = [
  ['Wrong subject: "he" instead of "she"', null],
  ['她 (tā) means "she"; 他 (tā) is "he" — same sound, different character.', '她'],
  ['Wrong gender.', null],
  ['Wrong person: "you" instead of "she"', null],
  ['Wrong subject: you said I instead of she', null],
  ['She did not blame — he did', null],
  ['没 makes it negative.', '没'],
  ['Wrong person.', null],
  ['Close — but it’s about her, not him', null],
  ['“she”, not “he”', null],
  ['Use 她, not 他.', null],
  ['她 is "she"; 他 is "he".', '他'],
  ['她们 = they (women)', '她们'],
  ['Tense: "blames", not "blamed"', null],
  ['Past tense, not present.', null],
  ['Wrong verb: "praised", not "blamed"', null],
  ['"praised" vs "blamed" — past tense', null],
  ['Wrong time: tomorrow, not yesterday', null],
  ['明天 makes it future.', '明天'],
  ['"is blaming" or "blamed" — either', null],
  ['It is future — tomorrow.', null],
  ['', null],
];
const lines = lineCases.map(([text, quote]) => ({ text, quote, pronoun: unheardPronounLine(text, quote), tense: unheardTenseLine(text, quote) }));

const rolePairs: Array<[string, string]> = [
  ['He blames me', 'She blamed me.'], ["He didn't blame me", 'She blamed me.'], ['He blamed you', 'She blamed me.'],
  ['Nobody came', 'No one came'], ['They left us', 'They left us'], ['I blamed her', 'She blamed me'],
];
const roles = rolePairs.map(([a, b]) => ({ a, b, same: sameRolesAndPolarity(a, b) }));

const ROW = { prompt_en: '她责怪我。', model_answer: 'She blamed me.', model_pinyin: 'Tā zéguài wǒ.', exercise_type: 'listen_translate' };
const JEROME = {
  verdict: 'almost', headline: 'Wrong subject: "he" instead of "she"', corrected: '',
  tips: [{ text: '她 (tā) means "she"; 他 (tā) is "he" — same sound, different character.', quote: '她' }],
};
const almost = (headline: string, tips: unknown[] = [], corrected = '') => ({ verdict: 'almost', headline, corrected, tips });
const heard = (answer: string, extra: Partial<AnswerCheckInput> = {}): AnswerCheckInput => ({ ...ROW, answer, input: 'spoken', ...extra });
const raws: Array<{ raw: unknown; input: AnswerCheckInput }> = [
  { raw: JEROME, input: heard('He blames me.') },
  { raw: JEROME, input: heard('He blamed me') },
  { raw: JEROME, input: heard('It blamed me.') },
  { raw: almost('Tense: "blames", not "blamed"'), input: heard('She blames me', { input: 'typed' }) },
  { raw: JEROME, input: heard('He blames me a lot') },
  { raw: JEROME, input: heard("He didn't blame me") },
  { raw: JEROME, input: heard('He blamed you') },
  { raw: { verdict: 'wrong', headline: 'Wrong person.', corrected: '', tips: [] }, input: heard('He blames me') },
  { raw: { verdict: 'wrong', headline: 'Reversed: she blamed you, not you her.', corrected: '', tips: [] }, input: heard('I blamed her') },
  { raw: almost('Who blamed whom is swapped.'), input: heard('I blamed her') },
  { raw: almost('There is no negation — she DID blame you.'), input: heard("She didn't blame me") },
  { raw: almost('Wrong person: "you" instead of "she"'), input: heard('You blamed me') },
  { raw: almost('Tense: it is future (明天会).'), input: heard('She blamed me', { prompt_en: '她明天会责怪我。', model_answer: 'She will blame me tomorrow.' }) },
  { raw: almost('Past tense, not present.'), input: heard('She blames me', { prompt_en: '她责怪了我。' }) },
  { raw: JEROME, input: heard('He blamed me', { prompt_en: '她责怪了我。' }) },
  { raw: almost('Wrong subject: "he" instead of "I"'), input: heard('He blamed you', { prompt_en: '我责怪你。', model_answer: 'I blamed you.' }) },
  { raw: { verdict: 'acceptable', headline: 'Got it.', corrected: '', tips: [{ text: '她 is "she", not "he".', quote: '她' }, { text: 'Note 责怪 is a strong word.', quote: '责怪' }] }, input: heard('He blames me') },
  { raw: { verdict: 'acceptable', headline: 'Right, but "she", not "he".', corrected: '', tips: [] }, input: heard('He blames me') },
  { raw: { verdict: 'correct', headline: 'You understood it.', corrected: '', tips: [] }, input: heard('She blamed me') },
  // Answered in Chinese (a mini lesson's Listen and translate / the round said back in Chinese).
  { raw: almost('Use 她, not 他.', [{ text: '她 is "she"; 他 is "he".', quote: '他' }], '她责怪我'), input: { prompt_en: 'She blamed me.', model_answer: '她责怪我。', answer: '他责怪我', exercise_type: 'listen_translate', input: 'typed' } },
  { raw: almost('Wrong pronoun.', [{ text: '她 = she', quote: '她' }], '她昨天责怪我了。'), input: { prompt_en: 'She blamed me yesterday.', model_answer: '她昨天责怪了我。', answer: '他昨天责怪我了。', exercise_type: 'listen_translate', input: 'typed' } },
  { raw: almost('Wrong negation.', [], '她昨天没责怪我。'), input: { prompt_en: 'She blamed me yesterday.', model_answer: '她昨天责怪了我。', answer: '他昨天不责怪我。', exercise_type: 'listen_translate', input: 'typed' } },
  { raw: { verdict: 'wrong', headline: 'I and you swapped.', corrected: '', tips: [] }, input: { prompt_en: 'She blamed me.', model_answer: '她责怪我。', answer: '我责怪她', exercise_type: 'listen_translate', input: 'typed' } },
  // Seen: strict.
  { raw: almost('Use 她 for "she".', [], '她责怪我。'), input: { prompt_en: 'She blamed me.', model_answer: '她责怪我。', answer: '他责怪我。', exercise_type: 'translate', input: 'typed' } },
  { raw: almost('You read 他.'), input: { prompt_en: 'She blamed me.', model_answer: '她责怪我。', answer: '他责怪我。', exercise_type: 'read_aloud', input: 'spoken' } },
];
const forgiven = raws.map(({ raw, input }) => {
  const normalized = normalizeAnswerCheck(raw, input.answer, input.model_answer);
  return { raw, input, check: forgiveUnheard(normalized, input) };
});

writeFileSync(join(OUT, 'heard-check.json'), JSON.stringify({
  version: ANSWER_CHECK_VERSION,
  meaningVersion: MEANING_CHECK_VERSION,
  markers: UNHEARD_TENSE_MARKERS,
  third: THIRD_PERSON_WORDS,
  headlines: { both: HEARD_BOTH_HEADLINE, pronoun: HEARD_PRONOUN_HEADLINE, tense: HEARD_TENSE_HEADLINE, right: HEARD_RIGHT_HEADLINE, ta: HEARD_TA_HEADLINE },
  meaningKeys,
  stems,
  zh,
  lines,
  roles,
  forgiven,
}, null, 1));
