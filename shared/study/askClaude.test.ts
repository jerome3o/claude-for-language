import { describe, expect, it } from 'vitest';
import {
  ASK_CLAUDE_SPEED,
  ASK_CLAUDE_VOICE,
  ASK_CLIP_MAX_CHARS,
  askAnswerHidden,
  askAutoPlayId,
  askListeningCandidate,
  askQuickActions,
  asksForEnglish,
  effectiveAskLanguage,
  parseAskLanguage,
  parseAskListening,
  plainAnswerText,
  revealedWhenListeningOn,
  turnLanguage,
} from './askClaude';
import { askClaudeMenu, ASK_SENTENCE_TOOLS_MAX } from '../chats/messageMenu';
import { CHAT_READ_ALOUD_SPEED, chatReadAloudVoice } from '../chats/voice';
import { DEFAULT_LESSON_VOICE } from '../lesson/voices';

describe('Ask Claude listening (🎧 Listen first)', () => {
  const zh = (id: string, answer = '银行就是放钱的地方。') => ({ id, answer, answer_lang: 'zh' });
  it('reads in the app voice at the chat read-aloud speed, whatever voices the listener enabled', () => {
    expect(ASK_CLAUDE_VOICE).toBe(DEFAULT_LESSON_VOICE);
    expect(ASK_CLAUDE_VOICE).toBe(chatReadAloudVoice({ senderGender: null, enabled: ['female-shaonv'] }));
    expect(ASK_CLAUDE_SPEED).toBe(CHAT_READ_ALOUD_SPEED);
  });
  it('the setting is on only for true / 1', () => {
    expect(parseAskListening(true)).toBe(true);
    expect(parseAskListening(1)).toBe(true);
    expect(parseAskListening('1')).toBe(true);
    for (const v of [null, undefined, 0, false, 'true', 'on', 2]) expect(parseAskListening(v)).toBe(false);
  });
  it('only Claude’s Chinese answers are candidates — never English or Markdown answers', () => {
    expect(askListeningCandidate(zh('a'))).toBe(true);
    expect(askListeningCandidate({ id: 'a', answer: 'A bank 银行 is…', answer_lang: 'en' })).toBe(false);
    expect(askListeningCandidate({ id: 'a', answer: '银行', answer_lang: null })).toBe(false);
    expect(askListeningCandidate(zh('a', 'OK!'))).toBe(false);
    expect(askListeningCandidate(zh('a', '   '))).toBe(false);
    expect(askListeningCandidate(zh('a', '银'.repeat(ASK_CLIP_MAX_CHARS)))).toBe(true);
    expect(askListeningCandidate(zh('a', '银'.repeat(ASK_CLIP_MAX_CHARS + 1)))).toBe(false);
  });
  it('hides while on and not revealed', () => {
    expect(askAnswerHidden(zh('a'), { listening: true, revealed: [] })).toBe(true);
    expect(askAnswerHidden(zh('a'), { listening: true, revealed: new Set(['a']) })).toBe(false);
    expect(askAnswerHidden(zh('a'), { listening: false, revealed: [] })).toBe(false);
  });
  it('turning on keeps what is on screen visible', () => {
    const entries = [zh('a'), { id: 'b', answer: 'English', answer_lang: 'en' }, zh('c')];
    expect(revealedWhenListeningOn(entries, ['x'])).toEqual(['x', 'a', 'c']);
    expect(revealedWhenListeningOn(entries, ['a'])).toEqual(['a', 'c']);
    expect(revealedWhenListeningOn([zh('a'), zh('b')], ['x', 'y'], 2)).toEqual(['a', 'b']);
  });
  it('auto-plays a new hidden answer once, never over other audio', () => {
    const base = { listening: true, entries: [zh('a'), zh('b')], seen: ['a'], revealed: [] as string[], audioBusy: false };
    expect(askAutoPlayId(base)).toBe('b');
    expect(askAutoPlayId({ ...base, seen: new Set(['a', 'b']) })).toBeNull();
    expect(askAutoPlayId({ ...base, audioBusy: true })).toBeNull();
    expect(askAutoPlayId({ ...base, listening: false })).toBeNull();
    expect(askAutoPlayId({ ...base, revealed: ['b'] })).toBeNull();
    expect(askAutoPlayId({ ...base, entries: [zh('a'), { id: 'b', answer: 'in English', answer_lang: 'en' }] })).toBeNull();
    expect(askAutoPlayId({ ...base, entries: [] })).toBeNull();
  });
});

describe('Ask Claude language', () => {
  it('defaults to Chinese; only zh / en are choices', () => {
    expect(effectiveAskLanguage(null)).toBe('zh');
    expect(effectiveAskLanguage(undefined)).toBe('zh');
    expect(effectiveAskLanguage('fr')).toBe('zh');
    expect(effectiveAskLanguage('en')).toBe('en');
    expect(parseAskLanguage('zh')).toBe('zh');
    expect(parseAskLanguage('ZH')).toBeNull();
  });

  it('an explicit request for English wins for that turn; merely writing English does not', () => {
    for (const q of ['Explain it in English please', 'english please', 'Can you answer in English?', 'reply in english', 'switch to English', '用英文解释一下', '请用英语说', '英文解释']) {
      expect(asksForEnglish(q)).toBe(true);
      expect(turnLanguage('zh', q)).toBe('en');
    }
    for (const q of ['What does this mean?', 'Is English similar?', '这个词怎么用？', '', 'Englishman']) {
      expect(asksForEnglish(q)).toBe(false);
    }
    expect(turnLanguage(null, 'What does it mean?')).toBe('zh');
    expect(turnLanguage('en', '这个词怎么用？')).toBe('en');
  });
});

describe('plainAnswerText', () => {
  it('takes the Markdown out of a Chinese answer', () => {
    expect(plainAnswerText('## 银行\n\n**银行**是放钱的地方。\n\n- 银：钱\n* 行：店\n\n\n\n> 例句：我去`银行`。\n---\n')).toBe(
      '银行\n\n银行是放钱的地方。\n\n・银：钱\n・行：店\n\n例句：我去银行。',
    );
  });

  it('tables become one line per row; numbered lists and 「」 stay', () => {
    expect(plainAnswerText('| 字 | 意思 |\n| --- | --- |\n| 银 | 钱 |\n1. 我去银行。\n2. 「银行」')).toBe('字　意思\n银　钱\n1. 我去银行。\n2. 「银行」');
  });

  it('plain text is unchanged (trimmed)', () => {
    expect(plainAnswerText('  你好！\n我是你的老师。  ')).toBe('你好！\n我是你的老师。');
    expect(plainAnswerText('')).toBe('');
    expect(plainAnswerText('a*b and 3*4')).toBe('a*b and 3*4');
    expect(plainAnswerText('*银行*很有用')).toBe('银行很有用');
  });
});

describe('askQuickActions', () => {
  it('Chinese questions in Chinese mode, English in English mode; the optional chips', () => {
    const zh = askQuickActions({ language: 'zh', typedAnswer: false, hasSentence: false });
    expect(zh.map((a) => a.id)).toEqual(['sentences', 'characters', 'related', 'grammar', 'fun_fact']);
    expect(zh[0].question).toBe('请用这个词造几个简单的句子。');
    const en = askQuickActions({ language: 'en', typedAnswer: true, hasSentence: true });
    expect(en.map((a) => a.id)).toEqual(['sentences', 'characters', 'related', 'check_answer', 'grammar', 'fun_fact', 'sentence']);
    expect(en[0].label).toBe('Use in sentence');
  });
});

describe('askClaudeMenu', () => {
  const ids = (m: ReturnType<typeof askClaudeMenu>) => m.items.map((i) => i.id);

  it("Claude's short Chinese answer: copy, translate, pinyin, explain, save, coach (explain), read aloud — no reactions", () => {
    const m = askClaudeMenu({ mine: false, text: '银行就是放钱的地方。' });
    expect(m.reactions).toBe(false);
    expect(ids(m)).toEqual(['copy', 'translate', 'pinyin', 'explain', 'save_card', 'open_coach', 'play']);
  });

  it("a long answer: no sentence tools (explain / save / coach)", () => {
    const long = '银行'.repeat(ASK_SENTENCE_TOOLS_MAX);
    expect(ids(askClaudeMenu({ mine: false, text: long }))).toEqual(['copy', 'translate', 'pinyin', 'play']);
  });

  it('my flagged Chinese question: How to say it better + Open in Coach first', () => {
    const text = '银行是什么意？';
    expect(ids(askClaudeMenu({ mine: true, text, auto_check: { status: 'improvable', text } }))).toEqual([
      'say_better', 'open_coach', 'copy', 'translate', 'pinyin', 'explain', 'save_card', 'play',
    ]);
    // A stale or ok check: no "say better"; coach after save card.
    expect(ids(askClaudeMenu({ mine: true, text, auto_check: { status: 'improvable', text: '别的' } }))).toEqual([
      'copy', 'translate', 'pinyin', 'explain', 'save_card', 'open_coach', 'play',
    ]);
    // Even a long question of mine can go to the Coach.
    expect(ids(askClaudeMenu({ mine: true, text: '我'.repeat(200) }))).toContain('open_coach');
  });

  it('English: copy only; toggles show their state; a known translation works offline', () => {
    expect(ids(askClaudeMenu({ mine: true, text: 'What does it mean?' }))).toEqual(['copy']);
    expect(ids(askClaudeMenu({ mine: false, text: '**银行** (yínháng) means bank.', markdown: true }))).toEqual(['copy']);
    expect(askClaudeMenu({ mine: false, text: '  ' }).items).toEqual([]);
    const m = askClaudeMenu({ mine: false, text: '你好', translation: 'Hello' }, { pinyinOn: true, translateOn: false });
    expect(m.items.find((i) => i.id === 'pinyin')).toMatchObject({ label: 'Hide pinyin', active: true });
    expect(m.items.find((i) => i.id === 'translate')).toMatchObject({ label: 'Translate', needsInternet: false });
    expect(askClaudeMenu({ mine: false, text: '你好' }).items.find((i) => i.id === 'translate')?.needsInternet).toBe(true);
  });
});
