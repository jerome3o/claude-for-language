/**
 * Practice with Claude (shared/claude/practice.ts): the situations, levels, the form → context rule,
 * "Roleplay this word" from a card, the persona's voice, help requests and the reply language.
 * Writes claude-practice.json; checked by core/…/claude/ClaudePracticeParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_PRACTICE_LEVEL, PRACTICE_LEVELS, PRACTICE_SCENARIOS, PRACTICE_TEXT_MAX, PRACTICE_VOICE_SPEED,
  isPracticeHelpRequest, parsePracticeLevel, practiceContext, practiceFromCard, practiceReplyLanguage, practiceVoiceFor,
} from '../../../shared/claude/practice';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: claude-practice <out-dir>');
mkdirSync(OUT, { recursive: true });

const FORMS = [
  { scenario: '在饭店点菜', ai_role: '服务员', user_role: '客人', level: 'beginner' },
  { scenario: '  在饭店\n\t  点菜 ', ai_role: '  ', user_role: null, level: 'nope' },
  { scenario: '　　', ai_role: 'x', user_role: 'y', level: 'advanced' },
  { scenario: null, ai_role: null, user_role: null, level: null },
  { scenario: 'buying a train ticket to Shanghai', ai_role: 'the ticket seller', user_role: '', level: 'intermediate' },
  { scenario: '长'.repeat(250), ai_role: 'a'.repeat(300), user_role: 'b', level: null },
];
const contexts = FORMS.map((f) => ({ in: f, out: practiceContext(f) }));

const CARDS = [{ id: 'n1', hanzi: '银行' }, { id: 'n2', hanzi: '  一  路  平安 ' }, { id: 'n3', hanzi: '长'.repeat(60) }];
const fromCard = CARDS.flatMap((c) => [null, 'beginner' as const].map((level) => ({ in: c, level, out: practiceFromCard(c, level) })));

const VOICES = [
  { voice_id: 'Chinese (Mandarin)_Radio_Host', scenario: 'x', ai_role: 'y' },
  { voice_id: 'not-a-voice', scenario: '在饭店点菜', ai_role: '服务员 (a waiter)' },
  { scenario: '在饭店点菜', ai_role: '服务员 (a waitress)' },
  { scenario: '买水果', ai_role: '阿姨 (the stall owner)' },
  { scenario: '打车', ai_role: '司机师傅，男' },
  { scenario: '问路', ai_role: 'a man on the street' },
  { scenario: '问路', ai_role: 'a woman on the street' },
  { scenario: '问路', ai_role: 'mankind' },
  { scenario: '问路' },
  { ai_role: '新朋友 (a new friend)' },
  {},
  ...PRACTICE_SCENARIOS.map((p) => ({ scenario: p.scenario, ai_role: p.ai_role })),
  ...Array.from({ length: 30 }, (_, i) => ({ scenario: `场景${i}${'很长的情况'.repeat(i)}`, ai_role: i % 2 ? 'teacher' : '老板' })),
];
const voices = VOICES.map((v) => ({ in: v, out: practiceVoiceFor(v) }));

const HELP = [
  '💡 Give me a hint', '🆘 How do I say: the bill', '✏️ 请改一下我上一句话。', '  💡 提示一下', 'how do I say "spicy"?', 'How would you say this',
  'what should I say?', 'Hint please', 'helpful waiter', 'help', 'Correct me', 'correct my grammar', 'correctly',
  '“辣”怎么说？', '给我一个提示', '我要一碗米饭。', 'Can I have the menu?', '', '   ', 'say how do I say', 'howdo i say',
];
const help = HELP.flatMap((text) => (['zh', 'en'] as const).map((language) => ({ text, language, help: isPracticeHelpRequest(text), reply: practiceReplyLanguage(text, language) })));

writeFileSync(
  join(OUT, 'claude-practice.json'),
  JSON.stringify({
    levels: PRACTICE_LEVELS, defaultLevel: DEFAULT_PRACTICE_LEVEL, scenarios: PRACTICE_SCENARIOS, textMax: PRACTICE_TEXT_MAX, voiceSpeed: PRACTICE_VOICE_SPEED,
    parseLevel: ['beginner', 'intermediate', 'advanced', 'Beginner', '', null].map((v) => ({ in: v, out: parsePracticeLevel(v) })),
    contexts, fromCard, voices, help,
  }, null, 1),
);
