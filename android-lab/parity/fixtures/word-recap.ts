/**
 * Reader word recap (shared/study/wordRecap.ts): keys, read-aloud mistakes, runs built op by op
 * (taps, takes, answers, switches, finish) with every derived value after each op. Writes
 * word-recap.json; core WordRecapParityTest replays the same ops through WordRecap.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { judgeReadAloud } from '../../../shared/reader/readAloud';
import {
  addRecapMistakes, addRecapTap, answerRecap, emptyRecapRun, finishRecapRun, isRecapWord, markRecapped, recapAvailable,
  recapBar, recapChoices, recapDoneLine, recapKeepLabel, recapKey, recapMistakes, recapProgress, recapPromptLabel,
  recapPromptLine, recapRightFirstTime, recapRunFor, recapSentenceClue, recapWhyLines, restartRecap, setRecapKeep,
  type WordRecapPage, type WordRecapRun, type WordRecapTap, type WordRecapWord,
} from '../../../shared/study/wordRecap';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: word-recap <out-dir>');
mkdirSync(OUT, { recursive: true });

const KEYS = [' 成都，', '采耳', 'OK', 'A货', '“麻辣兔头”', '１２点', '', '  ', 'café', '春熙路！'];

const w = (text: string, pinyin = '', gloss = '') => ({ text, pinyin, gloss });
const P1: WordRecapPage = {
  index: 0, text: '他在春熙路采耳。', english: 'He gets his ears cleaned on Chunxi Road.',
  words: [w('他', 'tā', 'he'), w('在', 'zài', 'at'), w('春熙路', 'Chūnxī Lù', 'Chunxi Road'), w('采耳', "cǎi'ěr", 'ear cleaning'), w('。')],
};
const P2: WordRecapPage = {
  index: 1, text: '我们去成都吃麻辣兔头。', english: 'We go to Chengdu to eat spicy rabbit heads.',
  words: [w('我们', 'wǒmen', 'we'), w('去', 'qù', 'go'), w('成都', 'Chéngdū', 'Chengdu'), w('吃', 'chī', 'eat'), w('麻辣', 'málà', 'numbing and spicy'), w('兔头', 'tùtóu', 'rabbit head'), w('。')],
};
const P3: WordRecapPage = {
  index: 2, text: '“你去哪儿？”妈妈问。“我去银行。”小明说。今天下午他和朋友一起在成都最热闹的春熙路上舒舒服服地采耳。', english: '', words: null,
};

const MISTAKES: Array<[WordRecapPage, string]> = [
  [P2, '我们去程度吃麻辣兔头'],
  [P2, '我们去成都吃兔头了'],
  [P1, '他在春西路菜耳'],
  [P1, '他在春熙路采耳'],
  [P3, '你去哪妈妈问我去音行小明说今天下午他和朋友一起在程度最热闹的春西路上舒服地菜耳'],
  [{ ...P2, words: null }, '我们去程度吃麻辣兔头'],
];

type Op =
  | { op: 'tap'; tap: WordRecapTap; now: string }
  | { op: 'take'; page: WordRecapPage; transcript: string; now: string }
  | { op: 'answer'; key: string; right: boolean; now: string; id: string }
  | { op: 'keep'; key: string; on: boolean }
  | { op: 'finish'; now: string }
  | { op: 'recapped'; now: string }
  | { op: 'restart' };

const tap = (text: string, page: WordRecapPage, pos: number, sentence: string, extra: Partial<WordRecapTap> = {}): WordRecapTap => {
  const word = page.words?.find((x) => x.text === text);
  return { text, pinyin: word?.pinyin ?? '', gloss: word?.gloss ?? '', sentence, page: page.index, pos, page_english: page.english, ...extra };
};

const SCRIPTS: Op[][] = [
  [
    { op: 'tap', tap: tap('兔头', P2, 8, P2.text), now: '2026-11-03T10:00:01Z' },
    { op: 'tap', tap: tap('采耳', P1, 5, P1.text), now: '2026-11-03T10:00:02Z' },
    { op: 'take', page: P2, transcript: '我们去程度吃兔头', now: '2026-11-03T10:00:03Z' },
    { op: 'tap', tap: tap('成都', P2, 3, P2.text), now: '2026-11-03T10:00:04Z' },
    { op: 'tap', tap: tap('。', P2, 10, P2.text), now: '2026-11-03T10:00:05Z' },
    { op: 'take', page: P1, transcript: '他在春西路菜耳', now: '2026-11-03T10:00:06Z' },
    { op: 'finish', now: '2026-11-03T10:05:00Z' },
    { op: 'answer', key: '采耳', right: true, now: '2026-11-03T10:06:01Z', id: 'e1' },
    { op: 'keep', key: '成都', on: true },
    { op: 'answer', key: '成都', right: false, now: '2026-11-03T10:06:02Z', id: 'e2' },
    { op: 'keep', key: '采耳', on: true },
    { op: 'answer', key: '麻辣', right: true, now: '2026-11-03T10:06:03Z', id: 'e3' },
    { op: 'answer', key: '兔头', right: false, now: '2026-11-03T10:06:04Z', id: 'e4' },
    { op: 'answer', key: '成都', right: true, now: '2026-11-03T10:06:05Z', id: 'e5' },
    { op: 'keep', key: '采耳', on: false },
    { op: 'answer', key: '兔头', right: true, now: '2026-11-03T10:06:06Z', id: 'e6' },
    { op: 'recapped', now: '2026-11-03T10:07:00Z' },
    { op: 'restart' },
  ],
  [
    { op: 'take', page: P3, transcript: '你去哪妈妈问我去音行小明说今天下午他和朋友一起在程度最热闹的春西路上舒服地菜耳', now: '2026-11-03T09:00:00Z' },
    { op: 'tap', tap: tap('银行', P3, 13, '“我去银行。”小明说。', { pinyin: 'yínháng', gloss: 'bank' }), now: '2026-11-03T09:00:01Z' },
    { op: 'tap', tap: tap('OK', P1, 0, P1.text), now: '2026-11-03T09:00:02Z' },
    { op: 'finish', now: '2026-11-03T09:10:00Z' },
  ],
];

const OWNED = new Set(['采耳', '银行']);

function snapshot(run: WordRecapRun) {
  const p = recapProgress(run);
  const bar = recapBar(run);
  const c = recapChoices(run, (k) => OWNED.has(k));
  return {
    run,
    available: recapAvailable(run),
    progress: p,
    bar,
    rightFirstTime: recapRightFirstTime(run),
    add: c.add.map((x) => x.hanzi),
    bump: c.bump.map((x) => x.hanzi),
    promptLine: recapPromptLine(run),
    why: run.words.map(recapWhyLines),
    clues: run.words.map(recapSentenceClue),
  };
}

const scripts = SCRIPTS.map((ops) => {
  let run = emptyRecapRun('r-cd', '2026-11-03T08:00:00Z');
  const steps = ops.map((o) => {
    switch (o.op) {
      case 'tap': run = addRecapTap(run, o.tap, o.now); break;
      case 'take': run = addRecapMistakes(run, o.page, judgeReadAloud(o.page.text, o.transcript), o.now); break;
      case 'answer': run = answerRecap(run, o.key, o.right, o.now, o.id); break;
      case 'keep': run = setRecapKeep(run, o.key, o.on); break;
      case 'finish': run = finishRecapRun(run, o.now); break;
      case 'recapped': run = markRecapped(run, o.now); break;
      case 'restart': run = restartRecap(run); break;
    }
    return snapshot(run);
  });
  return { ops, steps };
});

const base = finishRecapRun(emptyRecapRun('r1', '2026-11-01T10:00:00Z'), '2026-11-01T11:00:00Z');
const open = emptyRecapRun('r1', '2026-11-01T10:00:00Z');
const runFor = [
  { existing: null, reader: 'r1', openedAt: '2026-11-02T08:00:00Z' },
  { existing: open, reader: 'r1', openedAt: '2026-11-02T08:00:00Z' },
  { existing: base, reader: 'r1', openedAt: '2026-11-02T08:00:00Z' },
  { existing: base, reader: 'r1', openedAt: '2026-11-01T10:30:00Z' },
  { existing: open, reader: 'r2', openedAt: '2026-11-02T08:00:00Z' },
].map((c) => ({ ...c, out: recapRunFor(c.existing, c.reader, c.openedAt, 'NOW') }));

const emptyWord: WordRecapWord = { hanzi: '采耳', pinyin: '', gloss: '', sentence: '', page_english: '', page: 0, pos: 0, reasons: ['tapped' as const], said: [], at: '' };
const sentenceClues = [
  '他在春熙路采耳。', '采耳', '他在春熙路(成都)采耳。', '今天下午他和朋友一起在成都最热闹的春熙路上舒舒服服地采耳。',
  '他说：“采耳很舒服。”', '采耳…', '他\n采耳。', '',
].map((sentence) => ({ sentence, out: recapSentenceClue({ ...emptyWord, sentence }) }));

const labels = {
  prompt: [0, 1, 2, 12].map((n) => [n, recapPromptLabel(n)]),
  keep: [recapKeepLabel(false), recapKeepLabel(true)],
  done: [[0, 0], [1, 0], [0, 1], [3, 2], [1, 1]].map(([a, b]) => [a, b, recapDoneLine(a, b)]),
};

writeFileSync(join(OUT, 'word-recap.json'), JSON.stringify({
  keys: KEYS.map((k) => ({ text: k, key: recapKey(k), word: isRecapWord(k) })),
  mistakes: MISTAKES.map(([page, transcript]) => ({
    page: page.text,
    words: page.words ? page.words.map((x) => x.text) : null,
    transcript,
    out: recapMistakes(judgeReadAloud(page.text, transcript), page.words ? page.words.map((x) => x.text) : null),
  })),
  scripts,
  runFor,
  sentenceClues,
  labels,
}, null, 1));

