/**
 * Practice per example sentence (shared/study/sentenceHistory.ts): events folded into per-sentence stats
 * (attempts / rights / misses / last per mode, hidden), "known", the least-known order, fresh sentences and
 * the fresh buffer ("more sentences wanted", how many, whether the note shows), and the Sentence round's
 * picks with that history (sentenceRound.ts pickRoundExercises — fresh first — and the listening round).
 * Writes sentence-history.json; core SentenceHistoryParityTest asserts SentenceHistory.kt / SentenceRound.kt match.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  sentenceStats, knownInMode, knownInAllModes, compareLeastKnown, wantsMoreSentences, sentenceHistoryKey, showHiddenLabel,
  moreSentencesWanted, isFreshSentence, freshSentenceCount, freshTopUpCount, sentencesComingShown,
  SENTENCE_FRESH_BUFFER, SENTENCE_FRESH_LOW, SENTENCE_TOPUP_MIN, SENTENCE_TOPUP_MAX, SENTENCE_TOPUP_RETRY_MS,
  SENTENCE_KNOWN_RIGHTS, SENTENCE_HIDE_REASONS, SENTENCE_HIDE_REASON_LABEL, SENTENCES_COMING_NOTE, SENTENCE_HIDE_TITLE,
  SENTENCE_HIDE_HINT, SENTENCE_HIDDEN_TOAST, SENTENCE_SHOW_AGAIN, SENTENCE_ROUND_MIN_VISIBLE, CLUE_SENTENCE_KEY,
  type SentencePracticeEvent, type SentenceStats,
} from '../../../shared/study/sentenceHistory';
import { pickRoundExercises, pickListenRoundExercises, listenRoundSentenceCount, sentenceRoundProgress, spreadOrder, type RoundSentence } from '../../../shared/study/sentenceRound';

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

const LISTEN_WORDS = ['银行', '句子', '句子2', '', ' 句\u3000子 ', '没有'];
const statsJson = (m: Map<string, SentenceStats>) => Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

const cases = [] as unknown[];
// 200 short lists with busy histories, then 160 longer ones (up to 16 sentences) with sparse histories —
// where fresh sentences, the fresh buffer and its top-up counts matter.
for (let i = 0; i < 360; i++) {
  const long = i >= 200;
  const n = long ? Math.floor(r() * 17) : Math.floor(r() * 9);
  const sentences: RoundSentence[] = [];
  if (r() < 0.7) sentences.push({ key: 'clue:n1', hanzi: '我去银行。', translation: r() < 0.3 ? null : 'I go to the bank.', audio: r() < 0.5 });
  for (let k = 0; k < n; k++) sentences.push({ key: `s${k}`, hanzi: `句子${k}。`, translation: r() < 0.12 ? (r() < 0.5 ? '' : null) : `Sentence ${k}.`, audio: r() < 0.75 });
  const keys = [...sentences.map((s) => sentenceHistoryKey(s.key)), 'gone'];
  const events: SentencePracticeEvent[] = [];
  const count = long ? Math.floor(r() * 10) : Math.floor(r() * 30);
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
      ev.mode = pick(['read', 'translate', 'listen', 'read', 'translate', 'listen', 'bad'] as never[]);
      ev.result = pick(['right', 'right', 'close', 'wrong', 'meh'] as never[]);
    }
    if (kind === 'hide') ev.reason = pick([...SENTENCE_HIDE_REASONS, 'bogus', null] as never[]);
    events.push(ev);
  }
  const stats = sentenceStats(events, 'n1');
  const keysWithStats = [...stats.keys()].sort();
  const known = keysWithStats.map((k) => ({
    key: k, read: knownInMode(stats.get(k), 'read'), translate: knownInMode(stats.get(k), 'translate'), listen: knownInMode(stats.get(k), 'listen'),
    all: [false, true].flatMap((translation) => [false, true].map((byEar) => ({ translation, byEar, known: knownInAllModes(stats.get(k), { translation, byEar }) }))),
  }));
  const compares = [] as unknown[];
  for (const a of keysWithStats) for (const b of keysWithStats) {
    for (const mode of ['read', 'translate', 'listen'] as const) compares.push({ a, b, mode, c: Math.sign(compareLeastKnown(stats.get(a)?.[mode], stats.get(b)?.[mode])) });
  }
  cases.push({
    sentences, events, stats: statsJson(stats), known, compares,
    wantsMore: wantsMoreSentences(sentences, stats),
    moreWanted: moreSentencesWanted(sentences, stats),
    comingShown: sentencesComingShown(moreSentencesWanted(sentences, stats)),
    freshCount: freshSentenceCount(sentences, stats),
    fresh: [...new Set(keys)].sort().map((k) => ({ key: k, fresh: isFreshSentence(stats.get(k)) })),
    exercises: pickRoundExercises(sentences, stats),
    // Sentences by ear: listen in the read slots where a sentence can be heard (online: with English).
    byEar: [true, false].map((online) => ({ online, exercises: pickRoundExercises(sentences, stats, { byEar: true, online }) })),
    // The listening card's round: "say it in Chinese" over the sentences that carry the word.
    listen: LISTEN_WORDS.map((word) => ({ word, exercises: pickListenRoundExercises(sentences, word, stats), count: listenRoundSentenceCount(sentences, word, stats) })),
    progress: [[], ['read:s0', 'translate:clue:n1'], ['read:s7', 'translate:s1', 'read:zzz']].map((ids) => ({
      ids, progress: sentenceRoundProgress(pickRoundExercises(sentences, stats), ids, sentences.map((x) => x.key)),
    })),
  });
}

// The fresh buffer's numbers: how many one top-up makes, and when "✨ New sentences coming" shows.
const topUpCounts = Array.from({ length: 23 }, (_, k) => k - 2).map((fresh) => ({ fresh, count: freshTopUpCount(fresh) }));
const comingShownVectors = [
  null,
  ...(['few', 'fresh'] as const).flatMap((reason) => [0, 1, 2, 3, 4, 5, 6, 9].map((fresh) => ({ reason, fresh }))),
].map((want) => ({ want, shown: sentencesComingShown(want) }));

const spreads = Array.from({ length: 12 }, (_, n) => ({ n, order: spreadOrder(n) }));

writeFileSync(join(OUT, 'sentence-history.json'), JSON.stringify({
  cases, spreads, topUpCounts, comingShown: comingShownVectors,
  keys: ['clue:n1', 'clue:abc', 'abc', 'clue'].map((k) => ({ row: k, key: sentenceHistoryKey(k) })),
  copy: {
    clueKey: CLUE_SENTENCE_KEY, knownRights: SENTENCE_KNOWN_RIGHTS, minVisible: SENTENCE_ROUND_MIN_VISIBLE,
    reasons: SENTENCE_HIDE_REASONS, reasonLabels: SENTENCE_HIDE_REASON_LABEL, coming: SENTENCES_COMING_NOTE,
    hideTitle: SENTENCE_HIDE_TITLE, hideHint: SENTENCE_HIDE_HINT, hiddenToast: SENTENCE_HIDDEN_TOAST, showAgain: SENTENCE_SHOW_AGAIN,
    showHidden: [0, 1, 7].map(showHiddenLabel),
    freshBuffer: SENTENCE_FRESH_BUFFER, freshLow: SENTENCE_FRESH_LOW, topUpMin: SENTENCE_TOPUP_MIN, topUpMax: SENTENCE_TOPUP_MAX,
    topUpRetryMs: SENTENCE_TOPUP_RETRY_MS,
  },
}, null, 1));
