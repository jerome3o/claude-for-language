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

writeFileSync(join(OUT, 'coach.json'), JSON.stringify({
  buttons, actions, cards, deepLinks, newWords, wordCards, newWordLabels,
  sentenceCardLabel: COACH_SENTENCE_CARD_LABEL, skipWords: [...COACH_SKIP_WORDS], maxNewWords: MAX_COACH_NEW_WORDS,
}));
