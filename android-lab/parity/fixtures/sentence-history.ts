/**
 * Practice per example sentence (shared/study/sentenceHistory.ts): events folded into per-sentence stats
 * (attempts / rights / misses / last per mode, hidden), "known", the least-known order, "wants more
 * sentences", and the Sentence round's picks with that history (sentenceRound.ts pickRoundExercises).
 * Writes sentence-history.json; core SentenceHistoryParityTest asserts SentenceHistory.kt / SentenceRound.kt match.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  sentenceStats, knownInMode, compareLeastKnown, wantsMoreSentences, sentenceHistoryKey, showHiddenLabel,
  SENTENCE_KNOWN_RIGHTS, SENTENCE_HIDE_REASONS, SENTENCE_HIDE_REASON_LABEL, SENTENCES_COMING_NOTE, SENTENCE_HIDE_TITLE,
  SENTENCE_HIDE_HINT, SENTENCE_HIDDEN_TOAST, SENTENCE_SHOW_AGAIN, SENTENCE_ROUND_MIN_VISIBLE, CLUE_SENTENCE_KEY,
  type SentencePracticeEvent, type SentenceStats,
} from '../../../shared/study/sentenceHistory';
import { pickRoundExercises, sentenceRoundProgress, spreadOrder, type RoundSentence } from '../../../shared/study/sentenceRound';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: sentence-history <out-dir>');
mkdirSync(OUT, { recursive: true });

let seed = 7_2026_1024;
const r = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

const statsJson = (m: Map<string, SentenceStats>) => Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

const cases = [] as unknown[];
for (let i = 0; i < 200; i++) {
  const n = Math.floor(r() * 9);
  const sentences: RoundSentence[] = [];
  if (r() < 0.7) sentences.push({ key: 'clue:n1', hanzi: '我去银行。', translation: r() < 0.3 ? null : 'I go to the bank.' });
  for (let k = 0; k < n; k++) sentences.push({ key: `s${k}`, hanzi: `句子${k}。`, translation: r() < 0.12 ? (r() < 0.5 ? '' : null) : `Sentence ${k}.` });
  const keys = [...sentences.map((s) => sentenceHistoryKey(s.key)), 'gone'];
  const events: SentencePracticeEvent[] = [];
  const count = Math.floor(r() * 30);
  for (let e = 0; e < count; e++) {
    const kind = pick(['attempt', 'attempt', 'attempt', 'attempt', 'hide', 'unhide', 'junk'] as const);
    const day = String(1 + Math.floor(r() * 9)).padStart(2, '0');
    const at = `2026-10-${day}T0${Math.floor(r() * 9)}:00:00.000Z`;
    const ev: SentencePracticeEvent = {
      id: r() < 0.08 && events.length ? events[Math.floor(r() * events.length)].id : `ev${i}-${e}`,
      note_id: r() < 0.06 ? 'n2' : 'n1',
      sentence_key: pick(keys),
      kind: kind as SentencePracticeEvent['kind'],
      at,
    };
    if (kind === 'attempt') {
      ev.mode = pick(['read', 'translate', 'read', 'translate', 'bad'] as never[]);
      ev.result = pick(['right', 'right', 'close', 'wrong', 'meh'] as never[]);
    }
    if (kind === 'hide') ev.reason = pick([...SENTENCE_HIDE_REASONS, 'bogus', null] as never[]);
    events.push(ev);
  }
  const stats = sentenceStats(events, 'n1');
  const keysWithStats = [...stats.keys()].sort();
  const known = keysWithStats.map((k) => ({ key: k, read: knownInMode(stats.get(k), 'read'), translate: knownInMode(stats.get(k), 'translate') }));
  const compares = [] as unknown[];
  for (const a of keysWithStats) for (const b of keysWithStats) {
    for (const mode of ['read', 'translate'] as const) compares.push({ a, b, mode, c: Math.sign(compareLeastKnown(stats.get(a)?.[mode], stats.get(b)?.[mode])) });
  }
  cases.push({
    sentences, events, stats: statsJson(stats), known, compares,
    wantsMore: wantsMoreSentences(sentences, stats),
    exercises: pickRoundExercises(sentences, stats),
    progress: [[], ['read:s0', 'translate:clue:n1'], ['read:s7', 'translate:s1', 'read:zzz']].map((ids) => ({
      ids, progress: sentenceRoundProgress(pickRoundExercises(sentences, stats), ids, sentences.map((x) => x.key)),
    })),
  });
}

const spreads = Array.from({ length: 12 }, (_, n) => ({ n, order: spreadOrder(n) }));

writeFileSync(join(OUT, 'sentence-history.json'), JSON.stringify({
  cases, spreads,
  keys: ['clue:n1', 'clue:abc', 'abc', 'clue'].map((k) => ({ row: k, key: sentenceHistoryKey(k) })),
  copy: {
    clueKey: CLUE_SENTENCE_KEY, knownRights: SENTENCE_KNOWN_RIGHTS, minVisible: SENTENCE_ROUND_MIN_VISIBLE,
    reasons: SENTENCE_HIDE_REASONS, reasonLabels: SENTENCE_HIDE_REASON_LABEL, coming: SENTENCES_COMING_NOTE,
    hideTitle: SENTENCE_HIDE_TITLE, hideHint: SENTENCE_HIDE_HINT, hiddenToast: SENTENCE_HIDDEN_TOAST, showAgain: SENTENCE_SHOW_AGAIN,
    showHidden: [0, 1, 7].map(showHiddenLabel),
  },
}, null, 1));
