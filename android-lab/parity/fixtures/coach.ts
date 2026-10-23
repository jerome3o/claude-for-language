/**
 * Sentence Coach golden vectors: the home screen's buttons (Check my sentence + Explain for
 * Chinese / mixed, Translate for English, disabled for empty), a conversation's action and the
 * "+ Add whole sentence as card" card from an Explain breakdown (shared/coach).
 * Writes coach.json; checked by core/…/CoachParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  coachButtons, conversationAction, breakdownSentenceCard, resolveCoachAction, coachDeepLinkAction,
  newWordsInSentence, newWordCards, addNewWordsButton, COACH_NEW_WORDS_LABEL, COACH_SENTENCE_CARD_LABEL, COACH_SKIP_WORDS, MAX_COACH_NEW_WORDS,
  coachMistakeLessonOffered, sentenceCore, mistakeLessonCardLine, parseMistakeLessonContent,
  COACH_MISTAKE_LESSON_LABEL, COACH_MISTAKE_LESSON_BUSY, MISTAKE_LESSON_CONTENT_TYPE,
  practiseSentence, practiseOutcome, practiseBlockNote, practiseMicEnabled,
  COACH_RESPOND_LABEL, COACH_PRACTISE_LABEL, COACH_PRACTISE_STOP, COACH_PRACTISE_AGAIN, COACH_PRACTISE_LISTEN,
  COACH_PRACTISE_LISTENING, COACH_PRACTISE_CHECKING, COACH_PRACTISE_OFFLINE, COACH_PRACTISE_EMPTY,
} from '../../../shared/coach';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const texts = [
  '', ' ', '\n\t', '　', '﻿', '我昨天去了商店买苹果', '你好！', "How do I say I'm running late?",
  'nǐ hǎo', '123', '我的app ostensibly加了视频功能', '你好ＯＫ', 'what does 把 mean', '〇', '㐀', '鿿', '豈',
  '  你好  ', 'ＡＢＣ', '😀', 'Ok 好', '一', 'zhōngwén 中文', '?', '，。',
];
const buttons = texts.map((text) => ({ text, result: coachButtons(text) }));

const actions = [
  { action: 'explain', input_language: 'zh' },
  { action: 'check', input_language: 'en' },
  { action: 'translate', input_language: 'zh' },
  { action: null, input_language: 'zh' },
  { action: null, input_language: 'en' },
  { action: 'grade', input_language: 'en' },
  { action: undefined, input_language: null },
].map((c) => ({ ...c, action: c.action ?? null, result: conversationAction(c) }));

const words = [
  { hanzi: '我', pinyin: 'wǒ', gloss: 'I' },
  { hanzi: ' 昨天 ', pinyin: ' zuótiān', gloss: 'yesterday ' },
  { hanzi: '', pinyin: 'x', gloss: 'dropped' },
  { hanzi: 'app', pinyin: '', gloss: '' },
  { hanzi: '了', pinyin: 'le', gloss: '' },
  { hanzi: '吗', pinyin: '', gloss: 'yes/no question' },
];
const cards = [
  { hanzi: ' 我昨天去了商店 ', pinyin: 'wǒ zuótiān', translation: 'I went.', words, construction: ' Time before verb. ' },
  { hanzi: '好', pinyin: 'hǎo', translation: null, words: [], construction: null },
  { hanzi: '好', pinyin: '', translation: '  ', words: [], construction: 'Just this.' },
  { hanzi: '你好吗', pinyin: 'nǐ hǎo ma', translation: 'How are you?', words: words.slice(0, 2), construction: '' },
].map((c) => ({ in: c, out: breakdownSentenceCard(c) }));

// Chat ↔ Coach: the deep link's action (explicit → runs, English alone → translate) and the server's resolver.
const linkActions = [null, '', 'check', 'explain', 'translate', 'grade', 'CHECK'];
const deepLinks = texts.flatMap((text) => linkActions.map((action) => {
  const r = resolveCoachAction(text.trim(), action);
  return { text, action, run: coachDeepLinkAction(text, action), resolved: r.ok ? r.action : null };
}));

// "➕ Add new words (N)": the words not in any deck yet, the picker's button and the card drafts.
const sentence = '我昨天去了商店买东西了';
const breakdown = [
  { hanzi: '我', pinyin: 'wǒ', gloss: 'I' },
  { hanzi: '昨天', pinyin: 'zuótiān', gloss: 'yesterday' },
  { hanzi: '去', pinyin: 'qù', gloss: 'go' },
  { hanzi: '了', pinyin: 'le', gloss: 'completed action' },
  { hanzi: ' 商店 ', pinyin: ' shāngdiàn ', gloss: ' shop ' },
  { hanzi: '买', pinyin: 'mǎi', gloss: 'buy' },
  { hanzi: '东西', pinyin: 'dōngxi', gloss: 'things' },
  { hanzi: '了', pinyin: 'le', gloss: 'change of state' },
  { hanzi: '。', pinyin: '', gloss: '' },
  { hanzi: 'app', pinyin: '', gloss: 'app' },
  { hanzi: '商店', pinyin: 'shāngdiàn', gloss: 'shop (again)' },
  { hanzi: '“东西”', pinyin: 'dōngxi', gloss: 'quoted' },
  { hanzi: '〇', pinyin: 'líng', gloss: 'zero' },
  { hanzi: '', pinyin: 'x', gloss: 'empty' },
  { hanzi: '吗', pinyin: 'ma', gloss: 'question' },
  { hanzi: '买 东西', pinyin: 'mǎi dōngxi', gloss: 'go shopping' },
  { hanzi: '𠀀', pinyin: '', gloss: 'extension B' },
];
const noteSets: Array<Array<string | null>> = [
  [],
  ['我', '昨天', '去', '买'],
  ['我', ' 昨天。', '去', '买', '东 西', null, ''],
  ['商店', '东西', '买东西'],
];
const newWords = noteSets.flatMap((notes) => [MAX_COACH_NEW_WORDS, 2, 0].map((max) => ({
  notes, max, words: breakdown, result: newWordsInSentence(breakdown, notes as string[], max),
})));
const wordCards = [
  { words: newWordsInSentence(breakdown, ['我'], 20), sentence: { hanzi: ` ${sentence} `, pinyin: ' wǒ zuótiān qù le shāngdiàn mǎi dōngxi le ', translation: 'I went to the shop yesterday.' } },
  { words: [{ hanzi: '商店', pinyin: 'shāngdiàn', gloss: 'shop' }], sentence: { hanzi: '商店', pinyin: 'shāngdiàn', translation: 'shop' } },
  { words: [{ hanzi: '东西', pinyin: 'dōngxi', gloss: 'things' }, { hanzi: '  ', pinyin: 'x', gloss: 'y' }], sentence: { hanzi: '我买东西', pinyin: null, translation: '  ' } },
  { words: [{ hanzi: '书', pinyin: 'shū', gloss: 'book' }], sentence: { hanzi: '我买东西', pinyin: 'wǒ', translation: 'x' } },
  { words: [{ hanzi: '书', pinyin: 'shū', gloss: 'book' }], sentence: { hanzi: '', pinyin: 'wǒ', translation: 'x' } },
].map((c) => ({ ...c, result: newWordCards(c.words, c.sentence) }));
const newWordLabels = [-1, 0, 1, 2, 7, 20].map((n) => ({ n, label: COACH_NEW_WORDS_LABEL(n), button: addNewWordsButton(n) }));

// "🎯 Mini lesson on this mistake": when it is offered, the sentence core, the card line, the stored content.
const mistakeChecks = ([
  ['我昨天去了商店买东西了', '我昨天去商店买东西了', false],
  ['我去商店', '我去商店', false],
  ['我去商店', '我去了商店', true],
  ['我 去商店', '我去商店。', false],
  ['你好!', '你好！', false],
  ['“你好”，  朋友～', '你好朋友', false],
  ["I'm late", '我迟到了', false],
  ['', '我', false],
  ['我', '', false],
  ['他很高', '他很高兴', false],
  ['我有三个书', '我有三本书', false],
  ['我　喜欢 你', '我喜欢你', false],
  ['abc 我', 'abc 你', false],
  ['价格$5+', '价格5', false],
] as Array<[string, string, boolean]>).map(([originalInput, corrected, isCorrect]) => ({
  originalInput, corrected, isCorrect,
  offered: coachMistakeLessonOffered({ originalInput, isCorrect, corrected: { hanzi: corrected } }),
  core: sentenceCore(originalInput),
}));
const mistakeCardLines = [0, 1, 2, 10].map((n) => ({ n, line: mistakeLessonCardLine(n) }));
const lessonSpec = {
  title: 'One 了',
  icon: '🎯',
  sections: [
    { title: 'A', exercises: [{ type: 'note', title: 'x' }, { type: 'choice', question: 'q', options: [{ hanzi: '了' }, { hanzi: '过' }], correct: 0 }] },
    { exercises: [{ type: 'translate', english: 'e', reference_hanzi: '我去了。' }] },
  ],
};
const mistakeContents = [
  JSON.stringify({ spec: lessonSpec }),
  JSON.stringify({ spec: lessonSpec, lesson_id: 'l1', saved_at: '2026-10-13T09:00:00.000Z', completed: true }),
  '', 'nope', '{"spec":{}}', '{"lesson_id":"x"}',
].map((raw) => {
  const c = parseMistakeLessonContent(raw);
  return { raw, parsed: c ? { lesson_id: c.lesson_id ?? null, completed: c.completed === true, title: c.spec.title, exercises: c.spec.sections.reduce((n, s) => n + s.exercises.length, 0) } : null };
});

// "🎤 Practise saying it": a take against the coach's sentence (shared/coach/practise.ts).
const practiseCases: Array<[string, string]> = [
  ['他在沙发上占了很多地方', '他在沙发上占了很多地方。'],
  ['他在沙发上站了很多地方。', '他在沙发上占了很多地方。'],
  ['他在沙发上放了很多东西', '他在沙发上占了很多地方。'],
  ['他在沙发上', '他在沙发上占了很多地方。'],
  ['你好。', '你好'],
  ['你号', '你好'],
  ['我昨天去了商店买东西。', '我昨天去商店买东西了。'],
  ['我很喜欢吃面条，你呢？', '我很喜欢吃面条，你呢？'],
  ['', '你好'],
  ['hello', '你好'],
  ['我想去一趟银行', '我想去趟银行。'],
  ['他长得很好看', '长得'],
];
const practise = practiseCases.map(([transcript, target]) => {
  const p = practiseSentence(transcript, target);
  return { transcript, target, said: p.said, verdict: p.verdict, state: p.result.state, chars: p.result.chars, outcome: practiseOutcome(p, null) };
});
const practiseBlocks = [null, 'offline', 'denied', 'no_mic', 'unsupported', 'mic_error'].map((blocked) => ({
  blocked, note: practiseBlockNote(blocked as never), mic: practiseMicEnabled(blocked as never),
}));
const practiseOutcomes = [null, 'failed', 'offline', 'empty'].map((failure) => ({ failure, outcome: practiseOutcome(null, failure as never) }));
const practiseCopy = {
  respond: COACH_RESPOND_LABEL, label: COACH_PRACTISE_LABEL, stop: COACH_PRACTISE_STOP, again: COACH_PRACTISE_AGAIN,
  listen: COACH_PRACTISE_LISTEN, listening: COACH_PRACTISE_LISTENING, checking: COACH_PRACTISE_CHECKING,
  offline: COACH_PRACTISE_OFFLINE, empty: COACH_PRACTISE_EMPTY,
};

writeFileSync(join(OUT, 'coach.json'), JSON.stringify({
  practise, practiseBlocks, practiseOutcomes, practiseCopy,
  mistakeChecks, mistakeCardLines, mistakeContents,
  mistakeLabel: COACH_MISTAKE_LESSON_LABEL, mistakeBusy: COACH_MISTAKE_LESSON_BUSY, mistakeContentType: MISTAKE_LESSON_CONTENT_TYPE,
  buttons, actions, cards, deepLinks, newWords, wordCards, newWordLabels,
  sentenceCardLabel: COACH_SENTENCE_CARD_LABEL, skipWords: [...COACH_SKIP_WORDS], maxNewWords: MAX_COACH_NEW_WORDS,
}));
