/**
 * Hard mode (shared/study/hardMode.ts): the setting (parse / cycle), which cards get it (red = learning /
 * relearning), the question's own result, whether the round follows, the Good / Easy lock and the words.
 * Writes hard-mode.json; core HardModeParityTest asserts HardMode.kt matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseHardMode, nextHardMode, isRedCard, hardModeApplies, hardModeQuestionResult, hardModeRoundFollows, goodEasyGate,
  ratingNeedsOverride, suggestedRating, overrideTap, overridePrompt, hardModeQuestionFeel, roundTakeFeel,
  hardModeChipLabel, hardModeNextLabel, hardModeSaidLine, HARD_MODES, HARD_MODE_TITLE, HARD_MODE_DESCRIPTION, HARD_MODE_OPTION,
  HARD_MODE_OPTION_HINT, HARD_MODE_CHIP, HARD_MODE_RESULT, HARD_MODE_CHECKING, HARD_MODE_UNKNOWN, HARD_MODE_TRY_AGAIN,
  HARD_MODE_SHOW_ANSWER, HARD_MODE_MISS_NOTE, HARD_MODE_GAVE_UP_LINE, HARD_MODE_RIGHT_BEAT_MS, HARD_MODE_OVERRIDE_MS,
  HARD_MODE_SUGGESTED, HARD_MODE_TAP_TWICE, HARD_MODE_TAP_AGAIN, STUDY_FEEL_VIBRATION, hardModeGiveUpInPlace, hardModeRevealedNextLabel, hardModeGaveUpCheer,
  HARD_MODE_REVEALED_TITLE, HARD_MODE_REVEALED_NOTE,
  hardModeReadAgainOffered, hardModeReadAgainResult, hardModeReadAgainVerdict, hardModeReadAgainLabel, HARD_MODE_READ_AGAIN_LISTENING,
  HARD_MODE_READ_AGAIN_STOP, HARD_MODE_READ_AGAIN_RESULT, HARD_MODE_READ_AGAIN_PRACTICE, HARD_MODE_READ_AGAIN_EMPTY,
  type HardModeTake, type OverrideArm,
} from '../../../shared/study/hardMode';
import { sentenceGate, sentenceGateLabel } from '../../../shared/study/sentencePractise';
import type { AnswerVerdict } from '../../../shared/cards/answer';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: hard-mode <out-dir>');
mkdirSync(OUT, { recursive: true });

const parse = [null, '', 'off', 'red', 'all', '1', '0', 'true', 'false', 'RED', 'x'].map((raw) => ({ raw, mode: parseHardMode(raw) }));
const next = HARD_MODES.map((mode) => ({ mode, next: nextHardMode(mode) }));
const red = [null, -1, 0, 1, 2, 3, 4].map((queue) => ({ queue, red: isRedCard(queue) }));
const applies = [] as unknown[];
for (const mode of HARD_MODES) for (const cardType of ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi', 'x']) for (const queue of [null, 0, 1, 2, 3]) {
  applies.push({ mode, cardType, queue, applies: hardModeApplies({ mode, cardType, queue }) });
}
const VERDICTS: (AnswerVerdict | null)[] = [null, 'exact', 'punctuation_only', 'equivalent', 'alternative', 'sound', 'contains', 'close', 'wrong'];
const TAKES: (HardModeTake | null)[] = [
  null, { status: 'checking' }, { status: 'unknown' },
  { status: 'done', isMatch: true, containsExpected: false }, { status: 'done', isMatch: false, containsExpected: true },
  { status: 'done', isMatch: true, containsExpected: true }, { status: 'done', isMatch: false, containsExpected: false },
  { status: 'done', isMatch: false, containsExpected: false, tonesOff: true },
];
const results = [] as unknown[];
for (const answerVerdict of VERDICTS) for (const take of TAKES) {
  const result = hardModeQuestionResult({ answerVerdict, take });
  results.push({
    answerVerdict, take, result,
    follows: [null, 0, 1, 4].map((count) => ({ count, follows: hardModeRoundFollows(result, count) })),
  });
}
const locks = [] as unknown[];
for (const cardType of ['hanzi_to_meaning', 'audio_to_hanzi']) for (const count of [null, 0, 1, 4]) for (const right of [[], ['read:a'], ['read:a', 'translate:b']]) for (const gaveUp of [false, true]) {
  const gate = sentenceGate({ enabled: true, cardType, sentenceCount: count, rightKeys: right });
  const g = goodEasyGate(gate, gaveUp, sentenceGateLabel(gate));
  locks.push({ cardType, count, right, gaveUp, gate, lock: g, needsOverride: [0, 1, 2, 3].map((r) => ratingNeedsOverride(r, g)), suggested: suggestedRating(g) });
}
// Taps on a rating: greyed or not, a first tap arms it, a second on the same rating within the window rates.
const ARMS: (OverrideArm | null)[] = [null, { rating: 2, at: 1000 }, { rating: 3, at: 1000 }, { rating: 2, at: 5000 }];
const taps = [] as unknown[];
for (const needsOverride of [false, true]) for (const rating of [0, 1, 2, 3]) for (const armed of ARMS) for (const now of [1000, 2500, 4000, 4001, 999]) {
  taps.push({ needsOverride, rating, armed, now, tap: overrideTap({ needsOverride, rating, armed, now }) });
}
const feels = {
  question: ([null, 'right', 'close', 'wrong', 'checking', 'unknown'] as const).map((result) => ({ result, feel: hardModeQuestionFeel(result) })),
  round: (['right', 'close', 'wrong', 'failed', 'empty'] as const).flatMap((result) => [false, true].map((done) => ({ result, done, feel: roundTakeFeel(result, done) }))),
};

// 🎤 Read it again on the answer in place (practice only): which answers offer it, a take's result and "You said" verdict.
const ANSWERS = ['他怎么把头发剪短了？', '银行', '再见。', 'OK', '', '2 个', '𠮷野家', 'ＡＢＣ'];
const SAIDS = ['他怎么把头发剪短了', '他这么拔，头发什么短了?', '银行。', '在见', '我去银行', '', 'abc', '2个', '𠮷野家！'];
const readAgain = {
  offered: ANSWERS.map((hanzi) => ({ hanzi, offered: hardModeReadAgainOffered(hanzi) })),
  takes: [] as unknown[],
  labels: [0, 1, 3].map(hardModeReadAgainLabel),
};
for (const isMatch of [false, true]) for (const containsExpected of [false, true]) for (const tonesOff of [false, true]) {
  const take = { isMatch, containsExpected, tonesOff };
  readAgain.takes.push({
    take, result: hardModeReadAgainResult(take),
    verdicts: ANSWERS.flatMap((hanzi) => SAIDS.map((said) => ({ said, hanzi, verdict: hardModeReadAgainVerdict(take, said, hanzi) }))),
  });
}

writeFileSync(join(OUT, 'hard-mode.json'), JSON.stringify({
  parse, next, red, applies, results, locks, taps, feels, readAgain,
  copy: {
    modes: HARD_MODES, title: HARD_MODE_TITLE, description: HARD_MODE_DESCRIPTION, option: HARD_MODE_OPTION, optionHint: HARD_MODE_OPTION_HINT,
    chip: HARD_MODE_CHIP, chipLabel: Object.fromEntries(HARD_MODES.map((m) => [m, hardModeChipLabel(m)])), result: HARD_MODE_RESULT,
    checking: HARD_MODE_CHECKING, unknown: HARD_MODE_UNKNOWN, tryAgain: HARD_MODE_TRY_AGAIN, showAnswer: HARD_MODE_SHOW_ANSWER,
    missNote: HARD_MODE_MISS_NOTE, gaveUpLine: HARD_MODE_GAVE_UP_LINE, beatMs: HARD_MODE_RIGHT_BEAT_MS,
    overrideMs: HARD_MODE_OVERRIDE_MS, suggested: HARD_MODE_SUGGESTED, tapTwice: HARD_MODE_TAP_TWICE, tapAgain: HARD_MODE_TAP_AGAIN, prompts: [0, 1, 2, 3, 9].map(overridePrompt),
    vibration: STUDY_FEEL_VIBRATION,
    giveUpInPlace: [null, 0, 1, 4].map((count) => ({ count, inPlace: hardModeGiveUpInPlace(count) })),
    revealedTitle: HARD_MODE_REVEALED_TITLE, revealedNote: HARD_MODE_REVEALED_NOTE,
    revealedNext: [true, false].map(hardModeRevealedNextLabel), gaveUpCheer: hardModeGaveUpCheer(2, 2),
    nextRound: hardModeNextLabel(true), nextAnswer: hardModeNextLabel(false),
    saidSpoken: hardModeSaidLine('银航', true), saidTyped: hardModeSaidLine('银行。', false),
    readAgainListening: HARD_MODE_READ_AGAIN_LISTENING, readAgainStop: HARD_MODE_READ_AGAIN_STOP, readAgainResult: HARD_MODE_READ_AGAIN_RESULT,
    readAgainPractice: HARD_MODE_READ_AGAIN_PRACTICE, readAgainEmpty: HARD_MODE_READ_AGAIN_EMPTY,
  },
}, null, 1));
