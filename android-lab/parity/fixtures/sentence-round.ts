/**
 * The Sentence round (shared/study/sentenceRound.ts): the card's sentences as one list, the four
 * exercises picked from it (modes, order, reuse when there are fewer), whether the round opens, its
 * progress and its words. Writes sentence-round.json; core SentenceRoundParityTest asserts SentenceRound.kt matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  roundSentences, pickRoundExercises, sentenceRoundOpens, sentenceRoundProgress, sentenceRoundCounter,
  sentenceRoundIntro, sentenceRoundCheer,
  SENTENCE_ROUND_SIZE, SENTENCE_ROUND_TITLE, SENTENCE_ROUND_SKIP, SENTENCE_ROUND_SKIP_CONFIRM, SENTENCE_ROUND_SKIP_CONFIRM_YES,
  SENTENCE_ROUND_SKIP_CONFIRM_NO, SENTENCE_ROUND_TRY_AGAIN, SENTENCE_ROUND_SEE_ANSWER,
  SENTENCE_ROUND_SHOW_ENGLISH, SENTENCE_ROUND_HIDE_ENGLISH, SENTENCE_ROUND_PROMPT, SENTENCE_ROUND_RESULT,
  SENTENCE_ROUND_ENGLISH_CHIP, SENTENCE_ROUND_TRANSLATION_OFFLINE, SENTENCE_ROUND_TRANSLATING, SENTENCE_ROUND_TRANSLATION_FAILED,
  roundRowMarks, orderKeysForRound, exercisesFromLog, roundExerciseParts, roundEnglishShown,
  listenRoundIntro, isCardSentenceKey, LISTEN_ROUND_SIZE, LISTEN_ROUND_LEAD, LISTEN_ROUND_SELF_CHECK_NOTE, LISTEN_ROUND_SHOW_CHINESE,
  LISTEN_ROUND_SELF_RIGHT, LISTEN_ROUND_SELF_WRONG,
  canListenTo, listenActiveId, exerciseAsRead, listenCheckBy, listenCheckInput, listenVerdictResult, listenSelfResult, parseSentencesByEar,
  SENTENCES_BY_EAR_TITLE, SENTENCES_BY_EAR_HINT, LISTEN_SLOW_RATE, LISTEN_EX_PLACEHOLDER, LISTEN_EX_LISTENING, LISTEN_EX_CHECKING,
  LISTEN_EX_PLAY, LISTEN_EX_SLOW, LISTEN_EX_SHOW_ANSWER, LISTEN_EX_SUBMIT, LISTEN_EX_SELF_QUESTION, LISTEN_EX_GOT_IT, LISTEN_EX_MISSED_IT,
  LISTEN_EX_YOU_SAID, LISTEN_EX_NO_AUDIO,
  isCardHanziSentence, roundSentenceCount, pickListenRoundExercises, listenRoundSentenceCount,
  LISTEN_EX_TAP_TO_LISTEN, SENTENCE_LISTEN_AUTOPLAY,
  listenRepeatCheck, roundTakeAfterReveal, roundTakeRecorded, roundRetryOffered, LISTEN_REPEAT_HEADLINE,
  type RoundSentence, type RoundLogEntry, type RoundExercise,
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
      return { ids, progress: p, counter: sentenceRoundCounter(p), intro: sentenceRoundIntro(p, exercises.length), cheer: sentenceRoundCheer(p) };
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
      return { ids, progress: p, counter: sentenceRoundCounter(p), intro: sentenceRoundIntro(p, exercises.length), cheer: sentenceRoundCheer(p) };
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

const english = [] as unknown[];
for (const mode of ['read', 'translate', 'listen'] as const) for (const status of [null, 'right', 'close', 'wrong'] as const) for (const answered of [false, true]) for (const toggled of [null, true, false]) {
  english.push({ mode, status, answered, toggled, shown: roundEnglishShown(mode, status, answered, toggled) });
}

// Sentences by ear: who can be heard, the exercise with the floor, the fallback, the check and the setting.
const TRANSLATIONS = [null, '', '  ', 'I go to the bank.'];
const canListen = [] as unknown[];
for (const translation of TRANSLATIONS) for (const audio of [false, true]) for (const byEar of [false, true]) for (const online of [false, true]) {
  canListen.push({ translation, audio, byEar, online, can: canListenTo({ translation, audio }, { byEar, online }) });
}
const listenExercises: RoundExercise[] = [
  { id: 'translate:a', key: 'a', mode: 'translate', index: 0 },
  { id: 'listen:b', key: 'b', mode: 'listen', index: 1 },
  { id: 'read:c', key: 'c', mode: 'read', index: 2 },
  { id: 'listen:d', key: 'd', mode: 'listen', index: 3 },
];
const active = [] as unknown[];
for (const answered of [[], ['listen:b'], ['listen:d'], ['listen:b', 'listen:d'], ['read:c']]) for (const chosen of [null, 'listen:b', 'listen:d', 'read:c', 'zzz']) {
  active.push({ answered, chosen, id: listenActiveId(listenExercises, answered, chosen) });
}
const listen = {
  canListen,
  active,
  asRead: listenExercises.map((ex) => ({ ex, read: exerciseAsRead(ex) })),
  checkBy: [false, true].flatMap((online) => TRANSLATIONS.map((t) => ({ online, translation: t, by: listenCheckBy(online, t) }))),
  inputs: [
    { row: { hanzi: ' 我去银行。', pinyin: 'Wǒ qù yínháng.', translation: 'I go to the bank. ' }, said: ' I go to the bank ', input: 'spoken' as const },
    { row: { hanzi: '好', pinyin: '  ', translation: null }, said: 'good', input: 'typed' as const },
    { row: { hanzi: '你好', pinyin: null, translation: 'Hello' }, said: 'hi', input: 'edited' as const },
    // Said back in Chinese: checked as what he heard (the Chinese as the model), a spoken take tidied.
    { row: { hanzi: '虾饺是我最喜欢的点心。', pinyin: 'Xiājiǎo shì wǒ zuì xǐhuan de diǎnxīn.', translation: 'Shrimp dumplings are my favourite dim sum.' }, said: '虾饺我最喜欢的。 点心。', input: 'spoken' as const },
    { row: { hanzi: '虾饺是我最喜欢的点心。', pinyin: null, translation: 'Shrimp dumplings are my favourite dim sum.' }, said: ' 虾饺我最喜欢的。 点心 ', input: 'typed' as const },
    { row: { hanzi: '我去银行。', pinyin: null, translation: null }, said: '我去。 学校', input: 'edited' as const },
  ].map((c) => ({ ...c, check: listenCheckInput(c.row, c.said, c.input) })),
  repeat: ([
    ['虾饺我最喜欢的。 点心。', '虾饺是我最喜欢的点心。'], ['虾饺是我最喜欢的点心', '虾饺是我最喜欢的点心。'], ['虾饺不是我最喜欢的', '虾饺是我最喜欢的点心。'],
    ['我去。 银行', '我去银行。'], ['我去银航', '我去银行。'], ['我去学校', '我去银行。'], ['I go to the bank', '我去银行。'], ['', '我去银行。'],
    ['我去银行', 'I go to the bank'], ['这是我书', '这是我的书。'],
  ] as const).map(([said, hanzi]) => ({ said, hanzi, check: listenRepeatCheck(said, hanzi) })),
  retry: (['read', 'translate', 'listen'] as const).flatMap((mode) => [false, true].map((seen) => ({
    mode, seen, after: roundTakeAfterReveal(mode, seen), recorded: roundTakeRecorded(mode, seen),
  }))),
  retryOffered: ([null, 'right', 'close', 'wrong'] as const).flatMap((status) => [false, true].flatMap((answered) => [false, true].map((busy) => ({
    status, answered, busy, offered: roundRetryOffered(status, answered, busy),
  })))),
  repeatHeadline: LISTEN_REPEAT_HEADLINE,
  verdicts: (['correct', 'acceptable', 'almost', 'wrong'] as const).map((v) => ({ verdict: v, result: listenVerdictResult(v) })),
  self: [true, false].map((g) => ({ gotIt: g, result: listenSelfResult(g) })),
  byEar: [null, '', '1', 'true', '0', 'false', 'x'].map((raw) => ({ raw, on: parseSentencesByEar(raw) })),
  copy: {
    title: SENTENCES_BY_EAR_TITLE, hint: SENTENCES_BY_EAR_HINT, slowRate: LISTEN_SLOW_RATE,
    tapToListen: LISTEN_EX_TAP_TO_LISTEN, autoplay: SENTENCE_LISTEN_AUTOPLAY,
    placeholder: LISTEN_EX_PLACEHOLDER, listening: LISTEN_EX_LISTENING, checking: LISTEN_EX_CHECKING, play: LISTEN_EX_PLAY,
    slow: LISTEN_EX_SLOW, showAnswer: LISTEN_EX_SHOW_ANSWER, submit: LISTEN_EX_SUBMIT, selfQuestion: LISTEN_EX_SELF_QUESTION,
    gotIt: LISTEN_EX_GOT_IT, missedIt: LISTEN_EX_MISSED_IT, youSaid: LISTEN_EX_YOU_SAID, noAudio: LISTEN_EX_NO_AUDIO,
  },
};

// The card's own text is never a round exercise (a sentence card whose clue is that same sentence).
const CARD_TEXTS = ['你和你妈妈除了聊这个，还聊什么了？', '你和你妈妈除了聊这个 还聊什么了', '「你和你妈妈除了聊这个,还聊什么了?」', '你和你妈妈除了聊这个，还聊什么了吗？',
  '银行', '银行。', 'Wi-Fi 密码是多少？', 'wifi密码是多少', '', '  ', '。', '？', 'ＡＢ银行', 'ab银行', '我去银行。', '我去银行'];
const sameText = CARD_TEXTS.flatMap((a) => CARD_TEXTS.map((b) => ({ hanzi: a, card: b, same: isCardHanziSentence(a, b) })));
const cardLists = [] as unknown[];
for (let i = 0; i < 80; i++) {
  const n = Math.floor(r() * 7);
  const card = CARD_TEXTS[Math.floor(r() * CARD_TEXTS.length)];
  const sentences: RoundSentence[] = Array.from({ length: n }, (_, k) => ({
    key: k === 0 && r() < 0.6 ? 'clue:n1' : `s${k}`,
    hanzi: r() < 0.35 ? CARD_TEXTS[Math.floor(r() * CARD_TEXTS.length)] : HANZI[Math.floor(r() * HANZI.length)] + k,
    translation: translation(),
  }));
  cardLists.push({
    card, sentences,
    exercises: pickRoundExercises(sentences, undefined, { cardHanzi: card }),
    count: roundSentenceCount(sentences, undefined, card),
    listen: pickListenRoundExercises(sentences, card),
    listenCount: listenRoundSentenceCount(sentences, card),
  });
}
const cardHanzi = { sameText, lists: cardLists };

writeFileSync(join(OUT, 'sentence-round.json'), JSON.stringify({
  lists, opens, answerSide, parts, english, listen, cardHanzi,
  copy: {
    size: SENTENCE_ROUND_SIZE, title: SENTENCE_ROUND_TITLE, skip: SENTENCE_ROUND_SKIP, skipConfirm: SENTENCE_ROUND_SKIP_CONFIRM,
    skipConfirmYes: SENTENCE_ROUND_SKIP_CONFIRM_YES, skipConfirmNo: SENTENCE_ROUND_SKIP_CONFIRM_NO, tryAgain: SENTENCE_ROUND_TRY_AGAIN,
    seeAnswer: SENTENCE_ROUND_SEE_ANSWER, showEnglish: SENTENCE_ROUND_SHOW_ENGLISH, hideEnglish: SENTENCE_ROUND_HIDE_ENGLISH,
    prompt: SENTENCE_ROUND_PROMPT, result: SENTENCE_ROUND_RESULT,
    englishChip: SENTENCE_ROUND_ENGLISH_CHIP, translationOffline: SENTENCE_ROUND_TRANSLATION_OFFLINE,
    translating: SENTENCE_ROUND_TRANSLATING, translationFailed: SENTENCE_ROUND_TRANSLATION_FAILED,
    listenSize: LISTEN_ROUND_SIZE, listenLead: LISTEN_ROUND_LEAD, listenSelfCheck: LISTEN_ROUND_SELF_CHECK_NOTE,
    listenShowChinese: LISTEN_ROUND_SHOW_CHINESE, listenSelfRight: LISTEN_ROUND_SELF_RIGHT, listenSelfWrong: LISTEN_ROUND_SELF_WRONG,
    listenIntros: [[0, 2, 3], [1, 2, 3], [0, 1, 1], [0, 2, 2]].map(([got, needed, n]) => ({ got, needed, n, intro: listenRoundIntro({ got, needed, done: got >= needed }, n) })),
    cardKeys: ['clue:n1', 'clue:', 'clue', 's1', 'xclue:a'].map((key) => ({ key, card: isCardSentenceKey(key) })),
  },
}, null, 1));
