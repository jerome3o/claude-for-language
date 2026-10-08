/**
 * Golden vectors for Ask Claude, immersion (docs/STUDY_SESSION.md "Ask Claude"): the long-press
 * menu of an Ask Claude message (shared/chats/messageMenu.ts — askClaudeMenu), the quick-question
 * chips and the answer language (shared/study/askClaude.ts). Writes ask-claude.json; checked by
 * core/…/AskClaudeParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { askClaudeMenu, ASK_SENTENCE_TOOLS_MAX, type AskMenuMessage } from '../../../shared/chats/messageMenu';
import {
  ASK_CLAUDE_SPEED,
  ASK_CLAUDE_VOICE,
  ASK_CLIP_MAX_CHARS,
  askAnswerHidden,
  askAutoPlayId,
  askListeningCandidate,
  askQuickActions,
  effectiveAskLanguage,
  parseAskLanguage,
  revealedWhenListeningOn,
  type AskListeningEntry,
} from '../../../shared/study/askClaude';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const texts = [
  '银行就是放钱的地方。',
  '银行是什么意？',
  '  我去银行。  ',
  'What does it mean?',
  'ok 好的',
  '',
  '   ',
  '〇',
  '银'.repeat(ASK_SENTENCE_TOOLS_MAX),
  '银'.repeat(ASK_SENTENCE_TOOLS_MAX + 1),
  ' ' + '行'.repeat(ASK_SENTENCE_TOOLS_MAX) + ' ',
  '**银行** (yínháng)',
];

const menus: unknown[] = [];
for (const text of texts)
  for (const mine of [true, false])
    for (const variant of [0, 1, 2, 3, 4, 5])
      for (const state of [{ pinyinOn: false, translateOn: false }, { pinyinOn: true, translateOn: false }, { pinyinOn: false, translateOn: true }, { pinyinOn: true, translateOn: true }]) {
        const msg: AskMenuMessage = { mine, text };
        if (variant === 1) msg.translation = 'Translated';
        if (variant === 2) msg.auto_check = { status: 'improvable', text };
        if (variant === 3) msg.auto_check = { status: 'ok', text };
        if (variant === 4) { msg.auto_check = { status: 'improvable', text: text + '了' }; msg.translation = ''; }
        if (variant === 5) msg.markdown = true;
        menus.push({ message: msg, state, result: askClaudeMenu(msg, state) });
      }

const quick: unknown[] = [];
for (const language of ['zh', 'en'] as const)
  for (const typedAnswer of [false, true])
    for (const hasSentence of [false, true]) quick.push({ language, typedAnswer, hasSentence, result: askQuickActions({ language, typedAnswer, hasSentence }) });

const languages = [null, '', 'zh', 'en', 'ZH', 'fr', 'english'].map((v) => ({ value: v, parsed: parseAskLanguage(v), effective: effectiveAskLanguage(v) }));

// 🎧 Listen first: which answers hide, history kept on switching on, the auto-play pick.
const answers: AskListeningEntry[] = [];
const answerTexts = ['银行就是放钱的地方。', '  我去银行。  ', 'OK!', '', '   ', 'A bank 银行', '〇', '㐀', '银'.repeat(ASK_CLIP_MAX_CHARS), '银'.repeat(ASK_CLIP_MAX_CHARS + 1), ' ' + '行'.repeat(ASK_CLIP_MAX_CHARS) + ' ', '・银：钱\n・行：店'];
answerTexts.forEach((answer, i) => {
  for (const lang of ['zh', 'en', null]) answers.push({ id: `a${i}-${lang}`, answer, answer_lang: lang });
});
const listening: unknown[] = [];
for (const e of answers)
  for (const on of [true, false])
    for (const revealed of [[], [e.id], ['x']]) listening.push({ entry: e, on, revealed, candidate: askListeningCandidate(e), hidden: askAnswerHidden(e, { listening: on, revealed }) });

const revealedOn: unknown[] = [];
for (const [entries, revealed, max] of [
  [answers.slice(0, 6), [], 500],
  [answers.slice(0, 9), ['a0-zh'], 500],
  [answers, ['x', 'y'], 3],
  [[], ['x'], 500],
] as Array<[AskListeningEntry[], string[], number]>)
  revealedOn.push({ entries, revealed, max, result: revealedWhenListeningOn(entries, revealed, max) });

const autoplay: unknown[] = [];
const zhA = { id: 'q1', answer: '银行就是放钱的地方。', answer_lang: 'zh' };
const zhB = { id: 'q2', answer: '我去银行取钱。', answer_lang: 'zh' };
const enB = { id: 'q3', answer: 'A **bank**.', answer_lang: 'en' };
for (const entries of [[], [zhA], [zhA, zhB], [zhA, enB]])
  for (const on of [true, false])
    for (const seen of [[], ['q1'], ['q1', 'q2']])
      for (const revealed of [[], ['q2']])
        for (const audioBusy of [false, true]) autoplay.push({ entries, on, seen, revealed, audioBusy, result: askAutoPlayId({ listening: on, entries, seen, revealed, audioBusy }) });

writeFileSync(
  join(OUT, 'ask-claude.json'),
  JSON.stringify({ max: ASK_SENTENCE_TOOLS_MAX, menus, quick, languages, voice: ASK_CLAUDE_VOICE, speed: ASK_CLAUDE_SPEED, clipMax: ASK_CLIP_MAX_CHARS, listening, revealedOn, autoplay }),
);
console.log(`ask-claude: ${menus.length} menus, ${quick.length} chip sets`);
