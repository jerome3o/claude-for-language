/**
 * Sentence Coach golden vectors: the home screen's buttons (Check my sentence + Explain for
 * Chinese / mixed, Translate for English, disabled for empty), a conversation's action and the
 * "+ Add whole sentence as card" card from an Explain breakdown (shared/coach).
 * Writes coach.json; checked by core/…/CoachParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { coachButtons, conversationAction, breakdownSentenceCard } from '../../../shared/coach';

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

writeFileSync(join(OUT, 'coach.json'), JSON.stringify({ buttons, actions, cards }));
