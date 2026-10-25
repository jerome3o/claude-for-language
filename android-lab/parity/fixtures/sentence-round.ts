/**
 * The Sentence round (shared/study/sentenceRound.ts): the card's sentences as one list, the four
 * exercises picked from it (modes, order, reuse when there are fewer), whether the round opens, its
 * progress and its words. Writes sentence-round.json; core SentenceRoundParityTest asserts SentenceRound.kt matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  roundSentences, pickRoundExercises, sentenceRoundOpens, sentenceRoundProgress, sentenceRoundCounter,
  sentenceRoundIntro, sentenceRoundCheer, sentenceRoundSkipNote,
  SENTENCE_ROUND_SIZE, SENTENCE_ROUND_TITLE, SENTENCE_ROUND_SKIP, SENTENCE_ROUND_TRY_AGAIN, SENTENCE_ROUND_SEE_ANSWER,
  SENTENCE_ROUND_SHOW_ENGLISH, SENTENCE_ROUND_HIDE_ENGLISH, SENTENCE_ROUND_PROMPT, SENTENCE_ROUND_RESULT,
  roundRowMarks, orderKeysForRound, exercisesFromLog, roundExerciseParts,
  type RoundSentence, type RoundLogEntry,
} from '../../../shared/study/sentenceRound';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: sentence-round <out-dir>');
mkdirSync(OUT, { recursive: true });

// A seeded generator (mulberry32) so the vectors are stable.
let seed = 20261024;
const r = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const HANZI = ['我去银行。', '他在银行工作。', '银行几点开门？', '你知道附近有银行吗？', '我们明天一起去银行办事吧。', '银行旁边有一家很好吃的饭馆。', '我昨天在银行门口等了你半个小时。', '好'];
const translation = () => {
  const x = r();
  return x < 0.15 ? null : x < 0.22 ? '' : x < 0.27 ? '  ' : 'In English.';
};

const lists = [] as unknown[];
for (let i = 0; i < 160; i++) {
  const n = Math.floor(r() * 9);
  const set: RoundSentence[] = Array.from({ length: n }, (_, k) => ({ key: `s${k}`, hanzi: HANZI[Math.floor(r() * HANZI.length)] + k, translation: translation() }));
  const clueKind = r();
  const clue = clueKind < 0.3 ? null
    : clueKind < 0.4 && n > 0 ? { key: 'clue:n1', hanzi: set[0].hanzi, translation: translation() }
    : clueKind < 0.45 ? { key: 'clue:n1', hanzi: '  ', translation: 'x' }
    : { key: 'clue:n1', hanzi: '我去银行。', translation: translation() };
  const sentences = roundSentences({ clue, set });
  const exercises = pickRoundExercises(sentences);
  const rights = [[], exercises.slice(0, 1).map((e) => e.id), exercises.slice(1, 3).map((e) => e.id), [...exercises.map((e) => e.id), 'read:zzz'], ['read:zzz', 'translate:s0']];
  lists.push({
    clue, set, sentences, exercises,
    progress: rights.map((ids) => {
      const p = sentenceRoundProgress(exercises, ids);
      return { ids, progress: p, counter: sentenceRoundCounter(p), intro: sentenceRoundIntro(p, exercises.length), cheer: sentenceRoundCheer(p), skip: sentenceRoundSkipNote(p) };
    }),
  });
}

// Hand-picked short lists: 1, 2 and 3 sentences, with and without English (a sentence is in at most one exercise).
const SMALL: Array<Array<[string, string | null]>> = [
  [['a', 'A.']], [['a', null]],
  [['a', 'A.'], ['b', 'B.']], [['a', 'A.'], ['b', null]], [['a', null], ['b', 'B.']], [['a', null], ['b', null]],
  [['a', 'A.'], ['b', 'B.'], ['c', 'C.']], [['a', null], ['b', 'B.'], ['c', null]], [['a', 'A.'], ['b', null], ['c', null]],
];
for (const small of SMALL) {
  const set: RoundSentence[] = small.map(([key, t]) => ({ key, hanzi: `${key}我只有周末才有时间。`, translation: t }));
  const sentences = roundSentences({ clue: null, set });
  const exercises = pickRoundExercises(sentences);
  const rights = [[], exercises.slice(0, 1).map((e) => e.id), exercises.map((e) => e.id)];
  lists.push({
    clue: null, set, sentences, exercises,
    progress: rights.map((ids) => {
      const p = sentenceRoundProgress(exercises, ids);
      return { ids, progress: p, counter: sentenceRoundCounter(p), intro: sentenceRoundIntro(p, exercises.length), cheer: sentenceRoundCheer(p), skip: sentenceRoundSkipNote(p) };
    }),
  });
}

// The round on the answer side: marks, order, exercises back from the log.
const RESULTS = [undefined, null, 'right', 'close', 'wrong'] as const;
const IDS = ['read:a', 'translate:a', 'read:b', 'translate:c', 'read:clue:n1', 'translate:d', 'bogus', ':x', 'read:', 'listen:a'];
const answerSide = [] as unknown[];
for (let i = 0; i < 120; i++) {
  const log: RoundLogEntry[] = Array.from({ length: Math.floor(r() * 6) }, () => {
    const res = RESULTS[Math.floor(r() * RESULTS.length)];
    const id = IDS[Math.floor(r() * IDS.length)];
    return res === undefined ? { id } : { id, result: res };
  });
  const right = IDS.filter(() => r() < 0.2);
  const marks = roundRowMarks(log, right);
  const keys = ['a', 'b', 'c', 'd', 'clue:n1', 'e'].filter(() => r() < 0.8);
  const sentences = keys.map((k) => ({ key: k, hanzi: `${k}好`, translation: 'x' }));
  const hiddenKey = r() < 0.3 ? 'a' : null;
  answerSide.push({
    log, right, marks, keys, order: orderKeysForRound(keys, marks), hiddenKey,
    fromLog: exercisesFromLog(sentences, log.map((e) => e.id), (k) => k === hiddenKey),
  });
}
const parts = IDS.map((id) => ({ id, parts: roundExerciseParts(id) }));

const opens = [] as unknown[];
for (const enabled of [true, false]) for (const cardType of ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi', 'x']) for (const sentenceCount of [null, 0, 1, 5]) {
  opens.push({ enabled, cardType, sentenceCount, opens: sentenceRoundOpens({ enabled, cardType, sentenceCount }) });
}

writeFileSync(join(OUT, 'sentence-round.json'), JSON.stringify({
  lists, opens, answerSide, parts,
  copy: {
    size: SENTENCE_ROUND_SIZE, title: SENTENCE_ROUND_TITLE, skip: SENTENCE_ROUND_SKIP, tryAgain: SENTENCE_ROUND_TRY_AGAIN,
    seeAnswer: SENTENCE_ROUND_SEE_ANSWER, showEnglish: SENTENCE_ROUND_SHOW_ENGLISH, hideEnglish: SENTENCE_ROUND_HIDE_ENGLISH,
    prompt: SENTENCE_ROUND_PROMPT, result: SENTENCE_ROUND_RESULT,
  },
}, null, 1));
