/**
 * "💬 Ask Claude" chats on the Sentence Coach (shared/coach/askChat.ts): the conversation kind, the
 * title, which messages get Read it back, the words to recap (add / merge / cap, the words a
 * Read it back found mistakes in, the reason line), the recap label and the flashcards' default
 * ticks. Writes coach-ask.json; checked by core/…/CoachAskParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  addRecapWord, addRecapWords, askCardChecked, askConversationTitle, conversationKind, readBackMistakeWords, readBackOffered,
  readBackReasonLine, recapCountLabel, recapFocusWords, recapKey, type AskRecapWord,
  COACH_ASK_LABEL, COACH_ASK_HINT, COACH_ASK_EMPTY_EN, COACH_ASK_PLACEHOLDER_ZH, COACH_ASK_PLACEHOLDER_EN, COACH_ASK_THINKING_ZH,
  COACH_ASK_THINKING_EN, READ_BACK_LABEL, READ_BACK_LISTENING, RECAP_COMING_SOON, ASK_RECAP_MAX, COACH_ASK_MAX_CHARS,
} from '../../../shared/coach/askChat';
import { judgeReadAloud } from '../../../shared/reader/readAloud';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: coach-ask <out-dir>');
mkdirSync(OUT, { recursive: true });

const kinds = [
  { kind: 'ask', action: null, input_language: 'zh' },
  { kind: null, action: 'ask', input_language: 'zh' },
  { kind: null, action: 'explain', input_language: 'zh' },
  { kind: null, action: null, input_language: 'en' },
  { kind: null, action: null, input_language: null },
  { kind: 'other', action: 'translate', input_language: 'zh' },
].map((c) => ({ ...c, result: conversationKind(c) }));

const titles = ['  成都有什么\n好吃的？  ', '', '吃'.repeat(119), '吃'.repeat(120), '吃'.repeat(121), '😀'.repeat(130), 'hello　world\t!', 'a﻿b'].map((t) => ({ in: t, out: askConversationTitle(t) }));

const offered = [
  { role: 'assistant', content: '成都的火锅很有名。', answer_lang: 'zh', status: null },
  { role: 'assistant', content: '成都的火锅很有名。', answer_lang: 'zh', status: 'pending' },
  { role: 'assistant', content: 'Hot pot.', answer_lang: 'en', status: null },
  { role: 'assistant', content: 'OK', answer_lang: 'zh', status: null },
  { role: 'user', content: '火锅', answer_lang: 'zh', status: null },
  { role: 'assistant', content: '好'.repeat(2000), answer_lang: 'zh', status: null },
  { role: 'assistant', content: '好'.repeat(2001), answer_lang: 'zh', status: null },
  { role: 'assistant', content: '  ', answer_lang: 'zh', status: null },
  { role: 'assistant', content: '火锅', answer_lang: null, status: null },
].map((m) => ({ ...m, result: readBackOffered(m) }));

const w = (hanzi: string, extra: Partial<AskRecapWord> = {}): AskRecapWord => ({ hanzi, sentence: `我喜欢${hanzi}。`, reasons: ['tapped'], ...extra });
const steps: AskRecapWord[] = [
  w('火锅', { pinyin: 'huǒguō' }),
  w('麻辣'),
  { hanzi: ' 火 锅 ', sentence: '另一句。', reasons: ['said_wrong'], gloss: 'hot pot', reason_line: 'Tone off on 锅' },
  w('OK'),
  w('  '),
  { hanzi: '麻辣', sentence: '', reasons: ['said_wrong', 'tapped'], pinyin: '  ', reason_line: '' },
  w('担担面', { gloss: ' dandan noodles ', sentence: '  吃担担面。 ' }),
  { hanzi: '火锅', sentence: 'x', reasons: ['tapped'], reason_line: 'Missed 锅' },
];
const recapRuns = [ASK_RECAP_MAX, 2, 1].map((max) => {
  const states: AskRecapWord[][] = [];
  let list: AskRecapWord[] = [];
  for (const s of steps) {
    list = addRecapWord(list, s, max);
    states.push(list);
  }
  return { max, steps, states, all: addRecapWords([], steps, max) };
});

const READS: [string, string[], string][] = [
  ['成都的火锅很辣。', ['成都', '的', '火锅', '很', '辣', '。'], '成都的活过很'],
  ['成都的火锅很辣。', ['成都', '的', '火锅', '很', '辣', '。'], '成都的火锅很辣'],
  ['成都的火锅很辣。', ['nope'], '成都的火锅很'],
  ['成都的火锅很辣。', [], '成都的火锅很'],
  ['我去银行。你呢？', ['我', '去', '银行', '。', '你', '呢', '？'], '我去音行你呢'],
  ['他说：“你好！”我们走吧。', ['他', '说', '：“', '你好', '！”', '我们', '走', '吧', '。'], '他说你号我们走'],
  ['现在12点。', ['现在', '12', '点', '。'], '现在十三点'],
  ['OK，我们走吧！', ['OK', '，', '我们', '走', '吧', '！'], '我们嘴吧'],
  ['小明在巴黎。', ['小明', '在', '巴黎', '。'], '小明在吧离呀'],
];
const reads = READS.map(([text, words, said]) => {
  const result = judgeReadAloud(text, said);
  return { text, words, said, out: readBackMistakeWords(text, words, result) };
});
const reasonLines = READS.map(([text, , said]) => {
  const chars = judgeReadAloud(text, said).chars;
  return { text, said, line: readBackReasonLine(chars) };
});

const labels = [0, -1, 1, 2, 200].map((n) => ({ n, label: recapCountLabel(n) }));

const recapLists = [[], ['火锅', '麻辣'], [' 火 锅 ']];
const cards = [
  { hanzi: '火锅', already_have: false }, { hanzi: '火锅', already_have: true }, { hanzi: '串串', already_have: false }, { hanzi: '火 锅', already_have: false },
].flatMap((card) => recapLists.map((recap) => ({ card, recap, checked: askCardChecked(card, recap.map((hanzi) => ({ hanzi }))) })));

const focus = [
  [], ['火锅', ' 火锅', '麻辣', '  '], Array.from({ length: 50 }, (_, i) => `词${i}`), ['火 锅', '火锅'],
].map((list) => ({ list, out: recapFocusWords(list.map((hanzi) => ({ hanzi }))) }));
const keys = [' 火 锅 ', '　火锅\n', '', 'a b'].map((k) => ({ in: k, out: recapKey(k) }));

writeFileSync(
  join(OUT, 'coach-ask.json'),
  JSON.stringify({
    kinds, titles, offered, recapRuns, reads, reasonLines, labels, cards, focus, keys,
    copy: {
      label: COACH_ASK_LABEL, hint: COACH_ASK_HINT, emptyEn: COACH_ASK_EMPTY_EN, placeholderZh: COACH_ASK_PLACEHOLDER_ZH, placeholderEn: COACH_ASK_PLACEHOLDER_EN,
      thinkingZh: COACH_ASK_THINKING_ZH, thinkingEn: COACH_ASK_THINKING_EN, readBack: READ_BACK_LABEL, readBackListening: READ_BACK_LISTENING,
      comingSoon: RECAP_COMING_SOON, recapMax: ASK_RECAP_MAX, maxChars: COACH_ASK_MAX_CHARS,
    },
  }, null, 1),
);
