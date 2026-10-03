import { describe, it, expect } from 'vitest';
import { autoCheckApplies, autoCheckSettingShown, autoCheckSkipReason, parseAutoCheck, sayBetterLabel, sayBetterState } from './autoCheck';
import { messageMenu } from './messageMenu';

const S = '我昨天去了商店买东西了';

describe('autoCheckSkipReason', () => {
  it('skips no Chinese, emoji, ≤ 2 characters, mostly English, very long', () => {
    expect(autoCheckSkipReason('See you')).toBe('no_chinese');
    expect(autoCheckSkipReason('👍🎉')).toBe('no_chinese');
    expect(autoCheckSkipReason('好的！')).toBe('too_short');
    expect(autoCheckSkipReason(' 嗯 ')).toBe('too_short');
    expect(autoCheckSkipReason('I really like 饺子')).toBe('mostly_english');
    expect(autoCheckSkipReason('我'.repeat(401))).toBe('too_long');
    expect(autoCheckSkipReason(S)).toBeNull();
    expect(autoCheckSkipReason('我喜欢 KTV')).toBeNull();
  });
});

describe('who is checked', () => {
  it('default: the student side and the Claude practice chat; the setting wins either way', () => {
    expect(autoCheckApplies(null, 'student', false)).toBe(true);
    expect(autoCheckApplies(null, 'tutor', false)).toBe(false);
    expect(autoCheckApplies(null, 'tutor', true)).toBe(true);
    expect(autoCheckApplies(true, 'tutor', false)).toBe(true);
    expect(autoCheckApplies(false, 'student', true)).toBe(false);
    expect(autoCheckSettingShown(null, 'student')).toBe(true);
    expect(autoCheckSettingShown(null, 'tutor')).toBe(false);
    expect(autoCheckSettingShown(true, 'tutor')).toBe(true);
  });
});

describe('sayBetterState', () => {
  const mine = { sender_id: 'me', content: S, auto_check: { status: 'improvable' as const, text: S } };
  it('improvable on my own current text; the tutor correction wins; never for others / stale / media', () => {
    expect(sayBetterState(mine, 'me')).toBe('improvable');
    expect(sayBetterState({ ...mine, correction: { text: '我昨天去商店买东西了' } }, 'me')).toBe('corrected');
    expect(sayBetterState(mine, 'tutor')).toBeNull();
    expect(sayBetterState({ ...mine, content: '我改了' }, 'me')).toBeNull();
    expect(sayBetterState({ ...mine, auto_check: { status: 'ok', text: S } }, 'me')).toBeNull();
    expect(sayBetterState({ ...mine, deleted_at: 'x' }, 'me')).toBeNull();
    expect(sayBetterState({ ...mine, attachment: { kind: 'image' } }, 'me')).toBeNull();
    expect(sayBetterLabel('improvable')).toBe('Could be better — hold to see');
    expect(sayBetterLabel('corrected', 'Minghui Li')).toBe('Minghui corrected this — hold to see');
  });

  it('the menu starts with "How to say it better" and drops Check my Chinese once checked', () => {
    const items = messageMenu(mine, 'student', false, 'me').items.map((i) => i.id);
    expect(items[0]).toBe('say_better');
    expect(items).not.toContain('check');
    expect(items).not.toContain('view_corrections');
    const ok = messageMenu({ ...mine, auto_check: { status: 'ok', text: S } }, 'student', false, 'me').items.map((i) => i.id);
    expect(ok[0]).toBe('reply');
    expect(ok).not.toContain('check');
    // Stale after an edit: Check my Chinese is back.
    expect(messageMenu({ ...mine, content: '我改了一下' }, 'student', false, 'me').items.map((i) => i.id)).toContain('check');
    // Corrected by the tutor: first item too.
    expect(messageMenu({ sender_id: 'me', content: S, correction: { text: '我去了' } }, 'student', false, 'me').items[0].id).toBe('say_better');
    // The tutor looking at the student's message never gets it.
    expect(messageMenu({ ...mine, sender_id: 'stu' }, 'tutor', false, 'me').items[0].id).toBe('reply');
  });
});

describe('parseAutoCheck', () => {
  const stored = JSON.stringify({ text: S, status: 'improvable', corrected: '我昨天去商店买东西了', mistakes: [{ quote: '去了', fix: '去', why: 'x', card: { hanzi: '去', pinyin: 'qù', english: 'go', fun_facts: '' } }], severity: 'minor' });
  it('reads a stored result for the current text only', () => {
    expect(parseAutoCheck(stored, S)).toMatchObject({ status: 'improvable', severity: 'minor', mistakes: [{ fix: '去', card: { hanzi: '去' } }], alternative: null });
    expect(parseAutoCheck(stored, '别的')).toBeNull();
    expect(parseAutoCheck('not json', S)).toBeNull();
    expect(parseAutoCheck(null, S)).toBeNull();
  });
});
