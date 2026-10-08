/**
 * Golden vectors for Ask Claude, immersion (docs/STUDY_SESSION.md "Ask Claude"): the long-press
 * menu of an Ask Claude message (shared/chats/messageMenu.ts — askClaudeMenu), the quick-question
 * chips and the answer language (shared/study/askClaude.ts). Writes ask-claude.json; checked by
 * core/…/AskClaudeParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { askClaudeMenu, ASK_SENTENCE_TOOLS_MAX, type AskMenuMessage } from '../../../shared/chats/messageMenu';
import { askQuickActions, effectiveAskLanguage, parseAskLanguage } from '../../../shared/study/askClaude';

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

writeFileSync(join(OUT, 'ask-claude.json'), JSON.stringify({ max: ASK_SENTENCE_TOOLS_MAX, menus, quick, languages }));
console.log(`ask-claude: ${menus.length} menus, ${quick.length} chip sets`);
