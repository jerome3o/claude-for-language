/**
 * A read card's take checked by Claude (shared/study/readTakeCheck.ts): which takes go to Claude, the request
 * (and its cache key), Claude's verdict → the box's state, the checked take every rule reads, the reason line and
 * the words. Writes read-take-check.json; core ReadTakeCheckParityTest asserts ReadTakeCheck.kt matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  READ_TAKE_CHECKING, READ_TAKE_CHIP, hanCount, readTakeCheckApplies, readTakeCheckInput, readTakeChecked, readTakeClaudeState,
  readTakeDeviceState, readTakeReason,
} from '../../../shared/study/readTakeCheck';
import { answerCheckCacheText, ANSWER_CHECK_VERDICTS, type AnswerCheck, type AnswerCheckVerdict } from '../../../shared/lesson/answerCheck';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: read-take-check <out-dir>');
mkdirSync(OUT, { recursive: true });

const HANZI = ['我越学中文，越觉得英文很繁琐。', '银行', '好', '𠮷野家', 'ABC', '', ' 你好！'];
const TRANSCRIPTS: (string | null)[] = [null, '', 'hello', '我越学中文，越觉得英语很"繁琐"。', '音响', '号', 'ok 好'];
const CARD_TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'];
const TAKES = [
  { isMatch: false, containsExpected: false, tonesOff: false },
  { isMatch: true, containsExpected: false, tonesOff: false },
  { isMatch: false, containsExpected: true, tonesOff: false },
  { isMatch: false, containsExpected: false, tonesOff: true },
];

const counts = HANZI.map((hanzi) => ({ hanzi, count: hanCount(hanzi) }));
const states = TAKES.map((take) => ({ take, state: readTakeDeviceState(take) }));
const applies = [] as unknown[];
for (const cardType of CARD_TYPES) for (const hanzi of HANZI) for (const transcript of TRANSCRIPTS) for (const take of TAKES) {
  applies.push({ cardType, hanzi, transcript, take, applies: readTakeCheckApplies({ cardType, hanzi, transcript, comparison: take }) });
}
const inputs = [] as unknown[];
for (const pinyin of [null, '', ' wǒ yuè xué Zhōngwén, yuè juéde Yīngwén hěn fánsuǒ. ']) for (const english of [null, '', ' The more I study Chinese, the more I find English complicated. ']) {
  for (const transcript of ['我越学中文，越觉得英语很"繁琐"。', ' 我越学中文。 越觉得英语很繁琐 ']) {
    const input = readTakeCheckInput({ hanzi: ' 我越学中文，越觉得英文很繁琐。 ', pinyin, english, transcript });
    inputs.push({ pinyin, english, transcript, input, cacheText: answerCheckCacheText(input) });
  }
}
const CLAUDE: (AnswerCheckVerdict | null)[] = [null, ...ANSWER_CHECK_VERDICTS];
const claudeStates = ANSWER_CHECK_VERDICTS.map((verdict) => ({ verdict, state: readTakeClaudeState(verdict) }));
const checked = [] as unknown[];
for (const take of TAKES) for (const claude of CLAUDE) {
  const out = readTakeChecked(take, claude);
  checked.push({ take, claude, out: { isMatch: out.isMatch, containsExpected: out.containsExpected, tonesOff: !!out.tonesOff } });
}
const reasons = [] as unknown[];
for (const verdict of ANSWER_CHECK_VERDICTS) {
  for (const tips of [[], [{ text: 'Read 繁琐 again.' }], [{ text: 'Same line.' }]]) {
    const headline = tips.length && tips[0].text === 'Same line.' ? 'Same line.' : 'You said 英语 — the card has 英文 (same meaning).';
    const check: AnswerCheck = { verdict, headline, corrected: '', corrected_pinyin: '', tips, suggested: 'missed_it' };
    reasons.push({ verdict, headline, tips, reason: readTakeReason(check) });
  }
}

writeFileSync(join(OUT, 'read-take-check.json'), JSON.stringify({
  counts, states, applies, inputs, claudeStates, checked, reasons,
  copy: { chip: READ_TAKE_CHIP, checking: READ_TAKE_CHECKING },
}));
