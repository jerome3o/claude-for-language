import { describe, it, expect } from 'vitest';
import { autoCheckApplies, autoCheckSettingShown, autoCheckSkipReason, autoCheckText, coachDeepLink, openInCoachRequest, parseAutoCheck, sayBetterLabel, sayBetterState, showCoachChip } from './autoCheck';
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
    expect(sayBetterState({ ...mine, attachment: { kind: 'image' } }, 'me')).toBe('improvable') // a photo's caption is checked too (Chat ↔ Coach);
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

describe('auto-check of media messages (Chat ↔ Coach)', () => {
  const result = (text: string) => ({ status: 'improvable' as const, text });
  it('autoCheckText: a photo / file / video caption, a voice transcript once done, else nothing', () => {
    expect(autoCheckText({ content: '我的猫很可爱', attachment: { kind: 'image' } })).toBe('我的猫很可爱');
    expect(autoCheckText({ content: '看这个', attachment: { kind: 'file' } })).toBe('看这个');
    expect(autoCheckText({ content: '', attachment: { kind: 'video' } })).toBe('');
    expect(autoCheckText({ content: '', attachment: { kind: 'voice', transcript: '我去了', transcript_status: 'done' } })).toBe('我去了');
    expect(autoCheckText({ content: '', attachment: { kind: 'voice', transcript: null, transcript_status: 'pending' } })).toBe('');
    expect(autoCheckText({ content: '', attachment: { kind: 'voice', transcript: '我去了', transcript_status: 'failed' } })).toBe('');
    expect(autoCheckText({ content: '你好吗' })).toBe('你好吗');
  });

  it('sayBetterState / showCoachChip: a photo caption and a voice transcript count; stale or ok do not', () => {
    const photo = { sender_id: 'me', content: '我昨天去了商店买东西了', attachment: { kind: 'image' }, auto_check: result('我昨天去了商店买东西了') };
    expect(sayBetterState(photo, 'me')).toBe('improvable');
    expect(showCoachChip(photo, 'me')).toBe(true);
    expect(showCoachChip({ ...photo, auto_check: { status: 'ok' as const, text: photo.content } }, 'me')).toBe(false);
    expect(showCoachChip({ ...photo, content: '我昨天去商店了' }, 'me')).toBe(false);
    expect(showCoachChip(photo, 'tutor')).toBe(false);
    const voice = { sender_id: 'me', content: '', attachment: { kind: 'voice', transcript: '我去了商店了', transcript_status: 'done' }, auto_check: result('我去了商店了') };
    expect(sayBetterState(voice, 'me')).toBe('improvable');
    expect(showCoachChip(voice, 'me')).toBe(true);
  });

  it('openInCoachRequest: mine → check, theirs → explain, no Chinese → null; coachDeepLink', () => {
    expect(openInCoachRequest({ sender_id: 'me', content: '我的猫', attachment: { kind: 'image' } }, 'me')).toEqual({ text: '我的猫', action: 'check' });
    expect(openInCoachRequest({ sender_id: 'them', content: '你吃饭了吗？' }, 'me')).toEqual({ text: '你吃饭了吗？', action: 'explain' });
    expect(openInCoachRequest({ sender_id: 'me', content: 'hello' }, 'me')).toBeNull();
    expect(openInCoachRequest({ sender_id: 'me', content: '你好', deleted_at: 'x' }, 'me')).toBeNull();
    expect(coachDeepLink({ text: '我的猫', action: 'check' }, 'm1')).toBe('/coach?text=%E6%88%91%E7%9A%84%E7%8C%AB&action=check&from_message=m1');
  });
});
