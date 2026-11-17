/**
 * "Listen in context" (shared/study/listenContext.ts): row order (the card's sentence first
 * unless the set repeats it, then the set by position), row states, the auto-play choice, the
 * word-first ask, the top-up / "+ More" counts (natural sentences only — contrived set rows come last
 * and never count, shared/study/sentenceFocus.ts) and the labels, over seeded random notes.
 * Writes listen-context.json; core ListenContextParityTest asserts ListenContext.kt matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  listenAutoplay,
  listenContextRows,
  listenNaturalCount,
  listenRowLabel,
  listenRowState,
  listenHash,
  listenShownProps,
  listenShownRows,
  listenTopUpWant,
  moreSentencesCount,
  needsSentenceTopUp,
  pickListenRows,
  seededShuffle,
  topUpCount,
  wordTapAction,
  type ListenRowState,
} from '../../../shared/study/listenContext';
import { sentenceStats, type SentencePracticeEvent } from '../../../shared/study/sentenceHistory';
import { clauseBreaks, hanCount, simpleSentenceMaxHan, simpleSentenceProblems } from '../../../shared/study/sentenceSimplicity';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: listen-context <out-dir>');
mkdirSync(OUT, { recursive: true });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(5150);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
const SENTENCES = [
  '我去银行。', '银行在哪儿？', '这是银行。', '银行几点开门？', '他在银行工作。', '我们一起去吧。',
  '虽然今天下雨，但是我们还是去银行办事了，因为很急。', '我们公司附近新开的那家银行周末也营业吗？', '因为下雨，所以我没去银行。',
];
const TRANSLATIONS = ['I go to the bank.', '', '  ', 'Where is it?', null];
const FOCUSES = ['core', 'collocation', 'complex', 'shared_character', 'contrast', null, undefined];

const cases = [] as unknown[];
for (let c = 0; c < 200; c++) {
  const n = Math.floor(r() * 7);
  const sentences = Array.from({ length: n }, (_, i) => ({
    id: `s${c}-${i}`,
    hanzi: pick(SENTENCES),
    translation: pick(TRANSLATIONS),
    audio_url: r() < 0.6 ? `generated/s${c}-${i}.mp3` : null,
    position: r() < 0.9 ? Math.floor(r() * 10) : null,
    focus: pick(FOCUSES),
  }));
  const clue = r() < 0.2 ? null : { hanzi: r() < 0.1 ? '  ' : pick(SENTENCES), translation: pick(TRANSLATIONS), audio_url: r() < 0.5 ? 'generated/clue.mp3' : null };
  const rows = listenContextRows(`n${c}`, clue, sentences);
  const online = r() < 0.5;
  const cachedFlags = rows.map(() => r() < 0.5);
  const states: ListenRowState[] = rows.map((row, i) => listenRowState(row, { online, cached: cachedFlags[i] }));
  const played = Math.floor(r() * 3);
  const anyway = r() < 0.3;
  const playable = states.filter((s) => s !== 'unavailable').length;
  cases.push({
    noteId: `n${c}`,
    clue,
    sentences,
    rows,
    online,
    cached: cachedFlags,
    states,
    autoplayOn: listenAutoplay(true, states),
    autoplayOff: listenAutoplay(false, states),
    played,
    anyway,
    wordTap: wordTapAction({ sentencesPlayed: played, playableSentences: playable, playedWordAnyway: anyway }),
    total: rows.length,
    natural: listenNaturalCount(rows),
    needsTopUp: needsSentenceTopUp(listenNaturalCount(rows)),
    topUpCount: topUpCount(listenNaturalCount(rows)),
    moreCount: moreSentencesCount(listenNaturalCount(rows)),
    labels: rows.map((_, i) => [listenRowLabel(i, false), listenRowLabel(i, true)]),
  });
}

// Fresh sentences every showing: picks over the same kind of rows with a heard / hidden history, seeds and
// the previous showing's set (pickListenRows, listenTopUpWant, listenShownRows).
const KEYS_EXTRA = ['clue', 'gone'];
const picks = [] as unknown[];
for (let c = 0; c < 300; c++) {
  const n = Math.floor(r() * 12);
  const sentences = Array.from({ length: n }, (_, i) => ({
    id: `p${c}-${i}`,
    hanzi: r() < 0.5 ? pick(SENTENCES) : `${pick(SENTENCES)}${i}`,
    translation: pick(TRANSLATIONS),
    audio_url: null,
    position: i,
    focus: r() < 0.15 ? pick(['shared_character', 'contrast']) : 'core',
  }));
  const clue = r() < 0.3 ? null : { hanzi: pick(SENTENCES) };
  const rows = listenContextRows(`n${c}`, clue, sentences);
  const keys = [...rows.map((row) => (row.fromCard ? 'clue' : row.key)), ...KEYS_EXTRA];
  const events: SentencePracticeEvent[] = [];
  const count = Math.floor(r() * 20);
  for (let e = 0; e < count; e++) {
    const kind = pick(['heard', 'heard', 'heard', 'hide', 'unhide', 'attempt'] as const);
    const ev: SentencePracticeEvent = {
      id: `pe${c}-${e}`,
      note_id: `n${c}`,
      sentence_key: pick(keys),
      kind,
      at: `2026-11-${String(1 + Math.floor(r() * 9)).padStart(2, '0')}T0${Math.floor(r() * 9)}:00:00.000Z`,
    };
    if (kind === 'heard') ev.mode = 'listen_context';
    if (kind === 'attempt') { ev.mode = 'read'; ev.result = 'right'; }
    if (kind === 'hide') ev.reason = 'weird';
    events.push(ev);
  }
  const stats = sentenceStats(events, `n${c}`);
  const seed = `n${c}:seed${Math.floor(r() * 1e6)}`;
  const word = pick(['银行', '我们', '', null, '一石二鸟的办法我们都喜欢']);
  const prev = r() < 0.4 ? pickListenRows(rows, stats, { seed: `${seed}-prev`, word }).rows.map((x) => x.key) : r() < 0.2 ? [pick(keys)] : null;
  const showCount = r() < 0.8 ? undefined : Math.floor(r() * 7);
  const result = pickListenRows(rows, stats, { seed, word, previous: prev, count: showCount });
  const added = r() < 0.3 ? [pick(keys), ...result.rows.slice(0, 1).map((x) => x.key)] : [];
  picks.push({
    noteId: `n${c}`, clue, sentences, events, seed, word, previous: prev, count: showCount ?? null,
    keys: result.rows.map((x) => x.key), fresh: result.fresh, heardBefore: result.heardBefore, unheardLeft: result.unheardLeft,
    want: listenTopUpWant(result), props: listenShownProps(result),
    added, shown: listenShownRows(rows, [...result.rows.map((x) => x.key)].reverse(), added).map((x) => x.key),
  });
}

const TEXTS = [
  '', '银行', '我去银行。', '因为下雨，所以我没去。', '我去了。你呢？', '虽然下雨，但是我去了，因为很急。', '  我去银行。 ', '你好！！', '“我去银行。”',
  '我们公司附近新开的那家银行周末也营业吗？', '一石二鸟的办法我们都喜欢', 'Hello, world.', '他说：「好的，我们走吧；明天见。」', '〇一二三',
];
const simple = TEXTS.flatMap((text) => ['银行', '一石二鸟的办法我们都喜欢', null].map((word) => ({
  text, word, han: hanCount(text), breaks: clauseBreaks(text), max: simpleSentenceMaxHan(word), problems: simpleSentenceProblems(text, word),
})));
const hashes = ['', 'a', 'n1:seed', '银行|clue:n1', 'x'.repeat(40)].map((text) => ({ text, hash: listenHash(text) }));
const shuffles = Array.from({ length: 40 }, (_, k) => {
  const items = Array.from({ length: k % 9 }, (_, i) => `k${i}`);
  const seed = `s${k}-${Math.floor(r() * 1e6)}`;
  return { items, seed, out: seededShuffle(items, seed) };
});

writeFileSync(join(OUT, 'listen-context.json'), JSON.stringify({ cases, picks, simple, hashes, shuffles }));
