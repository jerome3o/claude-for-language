import { describe, it, expect } from 'vitest';
import { breakdownSentenceCard, coachButtons, coachInputKind, conversationAction, resolveCoachAction } from './actions';

describe('coachButtons', () => {
  it('Chinese → Check my sentence + Explain', () => {
    const b = coachButtons('我昨天去了商店买苹果');
    expect(b.kind).toBe('chinese');
    expect(b.actions).toEqual(['check', 'explain']);
    expect(b.enabled).toBe(true);
    expect(b.hint).toMatch(/Chinese/);
  });

  it('English → the single Translate button', () => {
    const b = coachButtons("How do I say I'm running late?");
    expect(b.kind).toBe('english');
    expect(b.actions).toEqual(['translate']);
    expect(b.enabled).toBe(true);
  });

  it('mixed Chinese + English → both Chinese buttons', () => {
    const b = coachButtons('我的app ostensibly加了视频功能');
    expect(b.kind).toBe('mixed');
    expect(b.actions).toEqual(['check', 'explain']);
    expect(b.enabled).toBe(true);
    expect(b.hint).toMatch(/English/);
  });

  it('empty or whitespace → the two buttons, disabled, no hint', () => {
    for (const text of ['', '   ', '\n\t']) {
      const b = coachButtons(text);
      expect(b.kind).toBe('empty');
      expect(b.actions).toEqual(['check', 'explain']);
      expect(b.enabled).toBe(false);
      expect(b.hint).toBeNull();
    }
  });

  it('pinyin and numbers without hanzi count as English; full-width letters count as mixed', () => {
    expect(coachInputKind('nǐ hǎo')).toBe('english');
    expect(coachInputKind('123')).toBe('english');
    expect(coachInputKind('你好ＯＫ')).toBe('mixed');
    expect(coachInputKind('你好！123')).toBe('chinese');
  });
});

describe('resolveCoachAction', () => {
  it('keeps the old auto-detection when no action is sent', () => {
    expect(resolveCoachAction('你好', undefined)).toEqual({ ok: true, action: 'check' });
    expect(resolveCoachAction('hello', null)).toEqual({ ok: true, action: 'translate' });
  });

  it('runs the requested action', () => {
    expect(resolveCoachAction('你好', 'explain')).toEqual({ ok: true, action: 'explain' });
    expect(resolveCoachAction('你好 ok', 'check')).toEqual({ ok: true, action: 'check' });
    expect(resolveCoachAction('hello', 'translate')).toEqual({ ok: true, action: 'translate' });
  });

  it('refuses check / explain without Chinese and unknown actions', () => {
    expect(resolveCoachAction('hello', 'explain').ok).toBe(false);
    expect(resolveCoachAction('hello', 'check').ok).toBe(false);
    expect(resolveCoachAction('你好', 'grade').ok).toBe(false);
  });
});

describe('breakdownSentenceCard', () => {
  it('glosses every word then the construction, as the card standard asks for a sentence', () => {
    const card = breakdownSentenceCard({
      hanzi: ' 我去商店买苹果 ',
      pinyin: 'wǒ qù shāngdiàn mǎi píngguǒ',
      translation: 'I go to the shop to buy apples.',
      words: [
        { hanzi: '我', pinyin: 'wǒ', gloss: 'I' },
        { hanzi: '去', pinyin: 'qù', gloss: 'go' },
        { hanzi: 'app', pinyin: '', gloss: '' },
      ],
      construction: '去 + place + verb: go somewhere to do something.',
    });
    expect(card).toEqual({
      hanzi: '我去商店买苹果',
      pinyin: 'wǒ qù shāngdiàn mǎi píngguǒ',
      english: 'I go to the shop to buy apples.',
      fun_facts: '我 (wǒ) I\n去 (qù) go\napp\n去 + place + verb: go somewhere to do something.',
    });
  });

  it('leaves fun_facts out when there is nothing to say', () => {
    expect(breakdownSentenceCard({ hanzi: '好', pinyin: 'hǎo', words: [] })).toEqual({ hanzi: '好', pinyin: 'hǎo', english: '' });
  });
});

describe('conversationAction', () => {
  it('reads the recorded action, else falls back to the input language', () => {
    expect(conversationAction({ action: 'explain', input_language: 'zh' })).toBe('explain');
    expect(conversationAction({ action: null, input_language: 'zh' })).toBe('check');
    expect(conversationAction({ input_language: 'en' })).toBe('translate');
  });
});

describe('coachDeepLinkAction', () => {
  it('an explicit valid action runs; Chinese without one waits; English translates; bad actions wait', async () => {
    const { coachDeepLinkAction } = await import('./actions');
    expect(coachDeepLinkAction('我去了商店了', 'check')).toBe('check');
    expect(coachDeepLinkAction('你吃饭了吗？', 'explain')).toBe('explain');
    expect(coachDeepLinkAction('我去了商店了', null)).toBeNull();
    expect(coachDeepLinkAction('I am late', undefined)).toBe('translate');
    expect(coachDeepLinkAction('I am late', 'check')).toBeNull();
    expect(coachDeepLinkAction('我去了', 'grade')).toBeNull();
    expect(coachDeepLinkAction('  ', 'check')).toBeNull();
  });
});
