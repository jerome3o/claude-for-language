import { describe, expect, it } from 'vitest';
import { LESSON_VOICE_IDS, LESSON_VOICE_POOLS } from '../lesson/voices';
import {
  DEFAULT_PRACTICE_LEVEL,
  PRACTICE_SCENARIOS,
  isPracticeHelpRequest,
  practiceContext,
  practiceFromCard,
  practiceReplyLanguage,
  practiceSnapshot,
  practiceVoiceFor,
} from './practice';
import { parseClaudeContext } from './context';

describe('Practice with Claude', () => {
  it('the situation form → a context (trimmed, a default level); no situation → null', () => {
    expect(practiceContext({ scenario: '  在饭店   点菜 ', ai_role: '服务员', user_role: '', level: 'nope' })).toEqual({ kind: 'practice', scenario: '在饭店 点菜', ai_role: '服务员', level: DEFAULT_PRACTICE_LEVEL });
    expect(practiceContext({ scenario: '   ' })).toBeNull();
    expect(practiceContext({ scenario: 'x'.repeat(500) })!.scenario).toHaveLength(200);
    // Every preset is a valid context the server accepts.
    for (const p of PRACTICE_SCENARIOS) expect(parseClaudeContext(practiceContext({ ...p, level: 'beginner' }))).toMatchObject({ kind: 'practice', scenario: p.scenario, level: 'beginner' });
  });

  it('from a card: the word in the situation, its note, the label for the badge', () => {
    const ctx = practiceFromCard({ id: 'n1', hanzi: ' 银行 ' });
    expect(ctx).toMatchObject({ kind: 'practice', note_id: 'n1', scenario: '用「银行」聊天', label: '银行', level: 'intermediate' });
    expect(parseClaudeContext(ctx)).toMatchObject({ kind: 'practice', note_id: 'n1' });
    expect(practiceSnapshot({ kind: 'practice', scenario: '问路', ai_role: '路人' })).toEqual({ label: '问路', sublabel: '路人' });
  });

  it('the voice: the stored one when it is an app voice; else stable per situation, by the role\'s gender', () => {
    const own = [...LESSON_VOICE_IDS][1];
    expect(practiceVoiceFor({ voice_id: own, scenario: 'x' })).toBe(own);
    const a = practiceVoiceFor({ voice_id: 'not-a-voice', scenario: '在饭店点菜', ai_role: '服务员 (a waiter)' });
    expect(LESSON_VOICE_IDS.has(a)).toBe(true);
    expect(practiceVoiceFor({ scenario: '在饭店点菜', ai_role: '服务员 (a waiter)' })).toBe(a);
    expect(LESSON_VOICE_POOLS.female).toContain(practiceVoiceFor({ scenario: '买水果', ai_role: '阿姨 (the stall owner)' }));
    expect(LESSON_VOICE_POOLS.male).toContain(practiceVoiceFor({ scenario: '打车', ai_role: '司机师傅，男' }));
  });

  it('help requests step out of the role-play; their reply is in his Ask language, a line is Chinese', () => {
    for (const t of ['💡 Give me a hint', '🆘 How do I say: the bill', '✏️ 请改一下我上一句话。', 'how do I say "spicy"?', '“辣”怎么说？']) expect(isPracticeHelpRequest(t), t).toBe(true);
    for (const t of ['我要一碗米饭。', 'Can I have the menu?', '']) expect(isPracticeHelpRequest(t), t).toBe(false);
    expect(practiceReplyLanguage('💡 Give me a hint', 'en')).toBe('en');
    expect(practiceReplyLanguage('我要一碗米饭。', 'en')).toBe('zh');
  });
});
