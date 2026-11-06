/**
 * Sentence answers checked by Claude (shared/study/sentenceAnswerCheck.ts): which answers go to Claude,
 * the request, the verdict mapping (→ the card's verdict, Hard mode's question result, the pass's
 * suggestion), the hold and the words. Writes sentence-answer-check.json; core
 * SentenceAnswerCheckParityTest asserts SentenceAnswerCheck.kt matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  isSentenceAnswer, sentenceAnswerCheckApplies, sentenceAnswerCheckInput, sentenceCheckedVerdict, sentenceCheckOutcome,
  sentenceCheckDifference, SENTENCE_CHECK_CARD_TYPES, SENTENCE_CHECKING, SENTENCE_CHECK_TYPE_INSTEAD,
} from '../../../shared/study/sentenceAnswerCheck';
import { answerCheckCacheText, ANSWER_CHECK_VERDICTS, type AnswerCheckVerdict } from '../../../shared/lesson/answerCheck';
import type { AnswerVerdict } from '../../../shared/cards/answer';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: sentence-answer-check <out-dir>');
mkdirSync(OUT, { recursive: true });

const HANZI = ['我早上喝咖啡是为了上班不困。', '早上喝咖啡', '银行', '一举两得', '你好！', '他长得很好', 'ABC', ''];
const ANSWERS: (string | null)[] = [null, '', '  ', '我早上喝咖啡，因为工作不困。', 'coffee', '很行', ' 我早上喝咖啡 '];
const VERDICTS: (AnswerVerdict | null)[] = [null, 'exact', 'punctuation_only', 'equivalent', 'alternative', 'sound', 'contains', 'close', 'wrong'];
const CARD_TYPES = ['meaning_to_hanzi', 'audio_to_hanzi', 'hanzi_to_meaning'];

const sentence = HANZI.map((hanzi) => ({ hanzi, sentence: isSentenceAnswer(hanzi) }));
const applies = [] as unknown[];
for (const cardType of CARD_TYPES) for (const hanzi of HANZI) for (const answer of ANSWERS) for (const verdict of VERDICTS) for (const multipleChoice of [false, true]) {
  applies.push({ cardType, hanzi, answer, verdict, multipleChoice, applies: sentenceAnswerCheckApplies({ cardType, hanzi, answer, verdict, multipleChoice }) });
}
const inputs = [] as unknown[];
for (const pinyin of [null, '', ' Wǒ zǎoshang hē kāfēi shì wèile shàngbān bú kùn. ']) for (const spoken of [true, false]) {
  const input = sentenceAnswerCheckInput({ english: " I drink coffee in the morning so I'm not sleepy at work. ", hanzi: ' 我早上喝咖啡是为了上班不困。', pinyin, answer: ' 我早上喝咖啡，因为工作不困。 ', spoken });
  inputs.push({ pinyin, spoken, input, cacheText: answerCheckCacheText(input) });
}
const CLAUDE: (AnswerCheckVerdict | null)[] = [null, ...ANSWER_CHECK_VERDICTS];
const checked = [] as unknown[];
for (const local of VERDICTS.filter((v): v is AnswerVerdict => v !== null)) for (const claude of CLAUDE) {
  checked.push({ local, claude, verdict: sentenceCheckedVerdict(local, claude) });
}
const outcomes = ANSWER_CHECK_VERDICTS.map((claude) => ({ claude, outcome: sentenceCheckOutcome(claude) }));
const PAIRS: [string, string][] = [
  ['我早上喝咖啡，因为工作不困。', '我早上喝咖啡是为了上班不困。'],
  ['我早上喝咖啡是为了上班不困', '我早上喝咖啡是为了上班不困。'],
  ['我有3本书', '我有三本书。'],
];
const differences = [] as unknown[];
for (const [said, model] of PAIRS) for (const claude of CLAUDE) differences.push({ said, model, claude, reason: sentenceCheckDifference(said, model, claude) });

writeFileSync(join(OUT, 'sentence-answer-check.json'), JSON.stringify({
  sentence, applies, inputs, checked, outcomes, differences,
  copy: { cardTypes: SENTENCE_CHECK_CARD_TYPES, checking: SENTENCE_CHECKING, typeInstead: SENTENCE_CHECK_TYPE_INSTEAD },
}, null, 1));
