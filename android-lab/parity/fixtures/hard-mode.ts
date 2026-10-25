/**
 * Hard mode (shared/study/hardMode.ts): the setting (parse / cycle), which cards get it (red = learning /
 * relearning), the question's own result, whether the round follows, the Good / Easy lock and the words.
 * Writes hard-mode.json; core HardModeParityTest asserts HardMode.kt matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseHardMode, nextHardMode, isRedCard, hardModeApplies, hardModeQuestionResult, hardModeRoundFollows, hardModeLock,
  hardModeChipLabel, hardModeNextLabel, hardModeSaidLine, HARD_MODES, HARD_MODE_TITLE, HARD_MODE_DESCRIPTION, HARD_MODE_OPTION,
  HARD_MODE_OPTION_HINT, HARD_MODE_CHIP, HARD_MODE_RESULT, HARD_MODE_CHECKING, HARD_MODE_UNKNOWN, HARD_MODE_TRY_AGAIN,
  HARD_MODE_SHOW_ANSWER, HARD_MODE_MISS_NOTE, HARD_MODE_GAVE_UP_LINE, HARD_MODE_GAVE_UP_BLOCKED, HARD_MODE_RIGHT_BEAT_MS,
  type HardModeTake,
} from '../../../shared/study/hardMode';
import { sentenceGate, sentenceGateLabel, sentenceGateBlockedNote } from '../../../shared/study/sentencePractise';
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
for (const count of [null, 0, 1, 4]) for (const right of [[], ['read:a'], ['read:a', 'translate:b']]) for (const gaveUp of [false, true]) {
  const gate = sentenceGate({ enabled: true, cardType: 'hanzi_to_meaning', sentenceCount: count, rightKeys: right });
  locks.push({ count, right, gaveUp, gate, lock: hardModeLock(gate, gaveUp, sentenceGateLabel(gate), sentenceGateBlockedNote(gate)) });
}

writeFileSync(join(OUT, 'hard-mode.json'), JSON.stringify({
  parse, next, red, applies, results, locks,
  copy: {
    modes: HARD_MODES, title: HARD_MODE_TITLE, description: HARD_MODE_DESCRIPTION, option: HARD_MODE_OPTION, optionHint: HARD_MODE_OPTION_HINT,
    chip: HARD_MODE_CHIP, chipLabel: Object.fromEntries(HARD_MODES.map((m) => [m, hardModeChipLabel(m)])), result: HARD_MODE_RESULT,
    checking: HARD_MODE_CHECKING, unknown: HARD_MODE_UNKNOWN, tryAgain: HARD_MODE_TRY_AGAIN, showAnswer: HARD_MODE_SHOW_ANSWER,
    missNote: HARD_MODE_MISS_NOTE, gaveUpLine: HARD_MODE_GAVE_UP_LINE, gaveUpBlocked: HARD_MODE_GAVE_UP_BLOCKED, beatMs: HARD_MODE_RIGHT_BEAT_MS,
    nextRound: hardModeNextLabel(true), nextAnswer: hardModeNextLabel(false),
    saidSpoken: hardModeSaidLine('银航', true), saidTyped: hardModeSaidLine('银行。', false),
  },
}, null, 1));
