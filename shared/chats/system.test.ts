import { describe, expect, it } from 'vitest';
import {
  installHowToSteps,
  isSystemMessage,
  systemFallbackContent,
  systemMessageText,
  systemMessageView,
} from './system';

const student = (otherName: string | null = 'Minghui Wang') => ({ viewerIsSender: false, otherName, relationshipId: 'rel-1' });
const sender = (otherName: string | null = 'Jerome Swannack') => ({ viewerIsSender: true, otherName, relationshipId: 'rel-1' });

describe('systemMessageView', () => {
  it('is null for an ordinary message', () => {
    expect(systemMessageView({ content: 'hi', system_kind: null }, student())).toBeNull();
    expect(isSystemMessage({ system_kind: '' })).toBe(false);
    expect(isSystemMessage({ system_kind: 'study_budget' })).toBe(true);
  });

  it('study budget: third person for the student, "You set …" for the tutor', () => {
    const msg = { system_kind: 'study_budget', system_data: { new_cards_per_day: 2, secondary_cards_per_day: 5, is_default: false } };
    expect(systemMessageText(msg, student())).toBe('📚 Minghui set your new cards to 2 a day (+5 extra)');
    expect(systemMessageText(msg, sender())).toBe("📚 You set Jerome's new cards to 2 a day (+5 extra)");
    const back = { system_kind: 'study_budget', system_data: { new_cards_per_day: 3, secondary_cards_per_day: 0, is_default: true } };
    expect(systemMessageText(back, student())).toBe('📚 Minghui set your new cards back to the usual 3 a day (no extra cards)');
    expect(systemMessageText(back, sender(null))).toBe("📚 You set your student's new cards back to the usual 3 a day (no extra cards)");
    expect(systemMessageText(msg, student(null))).toBe('📚 Your tutor set your new cards to 2 a day (+5 extra)');
  });

  it('a call: live with Join, then ended / missed', () => {
    const live = { system_kind: 'call_started', system_data: { call_id: 'c 1' } };
    expect(systemMessageView(live, student())).toMatchObject({ text: 'Minghui started a video call', action: { label: 'Join', path: '/calls/c%201' }, quiet: false });
    expect(systemMessageView(live, sender())).toMatchObject({ text: 'You started a video call', action: { label: 'Join' } });
    const ended = { system_kind: 'call_started', system_data: { call_id: 'c1', ended: true, missed: false } };
    expect(systemMessageView(ended, student())).toMatchObject({ text: 'Video call ended', action: null, quiet: true });
    const missed = { system_kind: 'call_started', system_data: { call_id: 'c1', ended: true, missed: true } };
    expect(systemMessageText(missed, student())).toBe('📹 Missed video call from Minghui');
    expect(systemMessageText(missed, sender())).toBe("📹 Video call · Jerome didn't join");
  });

  it('a card flag quotes the student; the tutor opens the card from her side', () => {
    const flag = { system_kind: 'card_flag', system_data: { flag_id: 'f1', note_id: 'n1', hanzi: '银行', pinyin: 'yínháng', english: 'bank', message: '总是和很行搞混' } };
    const tutorView = systemMessageView(flag, student('Jerome'));
    expect(tutorView).toMatchObject({ text: 'Jerome flagged 银行 for you', quote: '总是和很行搞混', action: { label: 'Open card', path: '/connections/rel-1/cards/n1' } });
    expect(systemMessageText(flag, student('Jerome'))).toBe('🚩 Jerome flagged 银行 for you: “总是和很行搞混”');
    expect(systemMessageView(flag, sender('Minghui'))).toMatchObject({ text: 'You flagged 银行 for Minghui', action: { path: '/cards/n1' } });
    // No note id: no button.
    const bare = { system_kind: 'card_flag', system_data: { hanzi: '银行', message: 'x' } };
    expect(systemMessageView(bare, student('Jerome'))?.action).toBeNull();
  });

  it('a flag reply quotes the tutor; the student opens their own card', () => {
    const reply = { system_kind: 'flag_reply', system_data: { flag_id: 'f1', note_id: 'n1', hanzi: '银行', reply: '银是金属' } };
    expect(systemMessageView(reply, student())).toMatchObject({ text: 'Minghui replied about 银行', quote: '银是金属', action: { path: '/cards/n1' } });
    expect(systemMessageView(reply, sender())).toMatchObject({ text: 'You replied about 银行', action: { path: '/connections/rel-1/cards/n1' } });
  });

  it('the install how-to carries the steps', () => {
    const howto = { system_kind: 'install_howto', system_data: { app_url: 'https://app.example' } };
    const v = systemMessageView(howto, student())!;
    expect(v.text).toBe('Minghui sent you how to install the app');
    expect(v.body).toContain('open https://app.example in Chrome');
    expect(systemMessageView(howto, sender())!.text).toBe('You sent Jerome how to install the app');
    expect(installHowToSteps(null)).toContain('open the app’s address in Chrome');
  });

  it('a group class: Join for the student only', () => {
    const g = { system_kind: 'group_class', system_data: { group_name: '周三班', session_id: 's1' } };
    expect(systemMessageView(g, student())).toMatchObject({ text: 'Minghui started the group class “周三班”', action: { label: 'Join', path: '/group-class/s1' } });
    expect(systemMessageView(g, sender())).toMatchObject({ text: 'You sent Jerome the link to the group class “周三班”', action: null, body: null });
  });

  it('an unknown kind or broken data shows the stored fallback', () => {
    expect(systemMessageView({ system_kind: 'homework_v9', content: ' Minghui sent homework ' }, student())).toMatchObject({ kind: 'unknown', text: 'Minghui sent homework' });
    expect(systemMessageText({ system_kind: 'homework_v9', content: 'Minghui sent homework' }, student())).toBe('Minghui sent homework');
    expect(systemMessageView({ system_kind: 'study_budget', system_data: 'not json', content: 'old' }, student())).toMatchObject({ kind: 'unknown', text: 'old' });
    // The raw stored JSON string parses too.
    expect(systemMessageText({ system_kind: 'study_budget', system_data: '{"new_cards_per_day":4,"secondary_cards_per_day":1}' }, student())).toBe(
      '📚 Minghui set your new cards to 4 a day (+1 extra)',
    );
  });
});

describe('systemFallbackContent (what older apps, e-mails and notifications read)', () => {
  it('is the recipient view, third person, with the join link / steps', () => {
    expect(systemFallbackContent('study_budget', { new_cards_per_day: 2, secondary_cards_per_day: 5 }, 'Minghui Wang')).toBe('📚 Minghui set your new cards to 2 a day (+5 extra)');
    expect(systemFallbackContent('call_started', { call_id: 'c1' }, 'Minghui', { url: 'https://app/calls/c1' })).toBe('📹 Minghui started a video call — join here: https://app/calls/c1');
    expect(systemFallbackContent('card_flag', { hanzi: '银行', message: '?' }, 'Jerome')).toBe('🚩 Jerome flagged 银行 for you: “?”');
    expect(systemFallbackContent('install_howto', { app_url: 'https://a' }, 'Minghui')).toMatch(/^📲 Minghui sent you how to install the app\n\nAndroid app/);
    expect(systemFallbackContent('group_class', { group_name: 'A', session_id: 's' }, 'Minghui', { url: 'https://g' })).toBe(
      '🧪 Minghui started the group class “A” — join here: https://g\n\nAn experimental group class: your tutor and a few other students on one video call.',
    );
  });
});
