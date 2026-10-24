/**
 * 🎤 on the study card's example sentence rows + "Get two sentences right before Good / Easy"
 * (shared/study/sentencePractise.ts): which test a row runs, a take's judgement (the Coach's
 * practise rule; translate takes that aren't the sentence go to Claude), the result / via merge,
 * the spoken translate check's input, the gate (needed / got / locked), which ratings it holds back
 * and its words. Writes sentence-practise.json; core SentencePractiseParityTest asserts SentencePractise.kt matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  sentencePractiseMode, sentenceTake, sentencePractiseResult, sentencePractiseVia, showCheckOnline,
  sentenceAnswerCheckInput, sentenceGate, ratingLockedByGate, sentenceGateLabel, sentenceGateBlockedNote,
  SENTENCE_PRACTISE_LABEL, SENTENCE_PRACTISE_LISTENING, SENTENCE_PRACTISE_STOP, SENTENCE_PRACTISE_CHECKING,
  SENTENCE_PRACTISE_CHECK_ONLINE, SENTENCE_GATE_TARGET, SENTENCE_GATE_CARD_TYPES,
  type SentencePractiseMode,
} from '../../../shared/study/sentencePractise';
import type { AnswerCheckVerdict } from '../../../shared/lesson/answerCheck';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: sentence-practise <out-dir>');
mkdirSync(OUT, { recursive: true });

const modes = [] as unknown[];
for (const englishFirst of [false, true]) for (const hanziShown of [false, true]) for (const translation of [null, '', '  ', 'I go to the bank.']) {
  modes.push({ englishFirst, hanziShown, translation, mode: sentencePractiseMode({ englishFirst, hanziShown, translation }) });
}

const targets = ['我去银行。', '他在沙发上占了很多地方。', '你好！', '由你决定吧', '一个苹果'];
const transcripts = [
  '', '我去银行', '我去银行。', '我要去银行', '我去', 'hello', '他在沙发上站了很多地方', '他在沙发上放了很多东西',
  '你好', '你好吗', '油你决定吧', '由你决定吧。', '一个苹果。', '一个平果', 'I went 银行', '我去我去银行',
];
const verdicts: (AnswerCheckVerdict | null)[] = [null, 'correct', 'acceptable', 'almost', 'wrong'];
const takes = [] as unknown[];
for (const mode of ['read', 'translate'] as SentencePractiseMode[]) for (const target of targets) for (const transcript of transcripts) {
  const t = sentenceTake(mode, transcript, target);
  takes.push({
    mode, target, transcript,
    said: t.practised.said,
    state: t.practised.result.state,
    askClaude: t.askClaude,
    results: verdicts.map((v) => sentencePractiseResult(t.practised, v)),
    via: [sentencePractiseVia(t, false), sentencePractiseVia(t, true)],
    checkOnline: [showCheckOnline(t, false, false), showCheckOnline(t, false, true), showCheckOnline(t, true, false)],
  });
}
const failures = (['failed', 'offline', 'empty', null] as const).map((f) => ({ failure: f, result: sentencePractiseResult(null, null, f) }));

const checkInputs = [
  { hanzi: '我去银行。', pinyin: ' wǒ qù yínháng ', translation: ' I go to the bank. ', said: '我要去银行' },
  { hanzi: '好', pinyin: null, translation: 'Good', said: '好' },
  { hanzi: '好', pinyin: '  ', translation: null, said: '很好' },
].map((c) => ({ ...c, input: sentenceAnswerCheckInput(c, c.said) }));

const gates = [] as unknown[];
const keySets = [[], ['a'], ['a', 'a'], ['a', 'b'], ['a', 'b', 'c']];
for (const enabled of [true, false]) for (const cardType of ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi', 'other']) for (const sentenceCount of [null, 0, 1, 2, 6, -3]) for (const rightKeys of keySets) {
  const g = sentenceGate({ enabled, cardType, sentenceCount, rightKeys });
  gates.push({
    enabled, cardType, sentenceCount, rightKeys, gate: g,
    locked: [0, 1, 2, 3].map((r) => ratingLockedByGate(r, g)),
    label: sentenceGateLabel(g),
    note: sentenceGateBlockedNote(g),
  });
}

writeFileSync(join(OUT, 'sentence-practise.json'), JSON.stringify({
  modes, takes, failures, checkInputs, gates,
  copy: {
    label: SENTENCE_PRACTISE_LABEL, listening: SENTENCE_PRACTISE_LISTENING, stop: SENTENCE_PRACTISE_STOP,
    checking: SENTENCE_PRACTISE_CHECKING, checkOnline: SENTENCE_PRACTISE_CHECK_ONLINE,
    target: SENTENCE_GATE_TARGET, cardTypes: SENTENCE_GATE_CARD_TYPES,
  },
}, null, 1));
