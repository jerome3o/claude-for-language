/**
 * "Right, but said differently" (shared/study/answerDifference.ts): which accepted answers hold Hard
 * mode's ladder with "You said" vs the model answer, the two lines' marks and the words. Writes
 * answer-difference.json; core AnswerDifferenceParityTest asserts AnswerDifference.kt matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  roundTakeDifference, questionDifference, differenceLines, sameAnswerWords, DIFFERENCE_REASONS, DIFFERENCE_TITLE,
  DIFFERENCE_SAID, DIFFERENCE_MODEL, DIFFERENCE_CARD, DIFFERENCE_HOLD_NOTE, DIFFERENCE_CONTINUE, DIFFERENCE_SAY_AGAIN,
} from '../../../shared/study/answerDifference';
import type { SpokenResultState } from '../../../shared/cards/spoken-result';
import type { AnswerCheckVerdict } from '../../../shared/lesson/answerCheck';
import type { AnswerVerdict } from '../../../shared/cards/answer';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: answer-difference <out-dir>');
mkdirSync(OUT, { recursive: true });

const PAIRS: [string, string][] = [
  ['我明天去北京', '我明天去北京。'],
  ['我 明天 去 北京！', '我明天去北京。'],
  ['我明天要去北京', '我明天去北京。'],
  ['明天我去北京', '我明天去北京。'],
  ['我有3本书', '我有三本书。'],
  ['我有两本书', '我有二本书'],
  ['他在游泳', '她在游泳。'],
  ['我昨天去北京', '我明天去北京'],
  ['', '我明天去北京'],
  ['ABC 你好', '你好'],
];
const LOCAL: SpokenResultState[] = ['match', 'sound', 'contains', 'close', 'wrong'];
const CLAUDE: (AnswerCheckVerdict | null)[] = [null, 'correct', 'acceptable', 'almost', 'wrong'];
const round = [] as unknown[];
for (const [said, model] of PAIRS) for (const mode of ['read', 'translate'] as const) for (const local of LOCAL) for (const claude of CLAUDE) {
  round.push({ said, model, mode, local, claude, reason: roundTakeDifference({ mode, said, model, local, claude }) });
}
const VERDICTS: (AnswerVerdict | null)[] = [null, 'exact', 'punctuation_only', 'equivalent', 'alternative', 'sound', 'contains', 'close', 'wrong'];
const question = VERDICTS.map((verdict) => ({ verdict, reason: questionDifference(verdict) }));
const same = PAIRS.map(([said, model]) => ({ said, model, same: sameAnswerWords(said, model) }));
const lines = [] as unknown[];
for (const [said, model] of PAIRS) for (const accepted of [true, false]) lines.push({ said, model, accepted, lines: differenceLines(said, model, accepted) });

writeFileSync(join(OUT, 'answer-difference.json'), JSON.stringify({
  round, question, same, lines,
  copy: {
    reasons: DIFFERENCE_REASONS, title: DIFFERENCE_TITLE, said: DIFFERENCE_SAID, model: DIFFERENCE_MODEL, card: DIFFERENCE_CARD,
    holdNote: DIFFERENCE_HOLD_NOTE, continue: DIFFERENCE_CONTINUE, sayAgain: DIFFERENCE_SAY_AGAIN,
  },
}, null, 1));
