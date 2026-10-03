import { describe, it, expect } from 'vitest';
import { messageMenu, menuText } from './messageMenu';
import { firstLink, layoutBubbles, localDay, tickFor, GROUP_GAP_MS } from './bubbles';

const ids = (m: ReturnType<typeof messageMenu>) => m.items.map((i) => i.id);
const base = { sender_id: 'them', content: '你好，今天怎么样？' };

describe('messageMenu', () => {
  it('a Chinese message from the tutor, seen by the student: every learning tool, in order', () => {
    expect(ids(messageMenu(base, 'student', false, 'me'))).toEqual([
      'reply', 'copy', 'forward', 'translate', 'pinyin', 'explain', 'save_card', 'select_cards', 'play', 'discuss', 'pin', 'info', 'select',
    ]);
  });

  it('my own Chinese message as the learner: Check my Chinese, Edit, Delete', () => {
    const m = messageMenu({ ...base, sender_id: 'me' }, 'student', false, 'me');
    expect(ids(m)).toEqual([
      'reply', 'copy', 'forward', 'translate', 'pinyin', 'explain', 'save_card', 'select_cards', 'check', 'play', 'discuss', 'pin', 'info', 'edit', 'delete', 'select',
    ]);
    expect(m.items.find((i) => i.id === 'delete')?.danger).toBe(true);
    expect(ids(messageMenu({ ...base, sender_id: 'me', check_status: 'needs_improvement' }, 'student', false, 'me'))).toContain('view_corrections');
    expect(ids(messageMenu({ ...base, sender_id: 'me', check_status: 'correct' }, 'student', false, 'me'))).not.toContain('check');
  });

  it('the tutor on the student message: Correct; with a correction Edit + Remove; the student gets a card from it', () => {
    expect(ids(messageMenu(base, 'tutor', false, 'me'))).toContain('correct');
    const corrected = { ...base, correction: { text: '你好！' } };
    const t = messageMenu(corrected, 'tutor', false, 'me');
    expect(t.items.find((i) => i.id === 'correct')?.label).toBe('Edit correction');
    expect(ids(t)).toContain('remove_correction');
    expect(ids(messageMenu({ ...corrected, sender_id: 'me' }, 'student', false, 'me'))).toContain('correction_card');
    expect(ids(messageMenu({ ...base, sender_id: 'me' }, 'tutor', false, 'me'))).not.toContain('check');
  });

  it('English text: no translate / pinyin / explain / save card / read aloud', () => {
    expect(ids(messageMenu({ sender_id: 'them', content: 'See you tomorrow' }, 'student', false, 'me'))).toEqual([
      'reply', 'copy', 'forward', 'select_cards', 'discuss', 'pin', 'info', 'select',
    ]);
  });

  it('toggles say Hide when on and need no internet once translated', () => {
    const m = messageMenu({ ...base, translation: 'Hi, how are you today?' }, 'student', false, 'me', { pinyinOn: true, translateOn: true });
    expect(m.items.find((i) => i.id === 'translate')).toEqual({ id: 'translate', label: 'Hide translation', icon: '🌐', needsInternet: false, active: true });
    expect(m.items.find((i) => i.id === 'pinyin')?.label).toBe('Hide pinyin');
    expect(messageMenu(base, 'student', false, 'me').items.find((i) => i.id === 'translate')?.needsInternet).toBe(true);
  });

  it('voice: tools work on the transcript; translate only when the transcript was translated; no read aloud / edit', () => {
    const v = { sender_id: 'me', content: '', attachment: { kind: 'voice', transcript: '我很好', translation: null } };
    expect(menuText(v)).toBe('我很好');
    expect(ids(messageMenu(v, 'student', false, 'me'))).toEqual(['reply', 'copy', 'forward', 'pinyin', 'explain', 'save_card', 'select_cards', 'discuss', 'pin', 'info', 'delete', 'select']);
    expect(ids(messageMenu({ ...v, attachment: { ...v.attachment, translation: "I'm fine" } }, 'student', false, 'me'))).toContain('translate');
    expect(ids(messageMenu({ ...v, attachment: { kind: 'voice', transcript: null } }, 'student', false, 'me'))).toEqual(['reply', 'forward', 'pin', 'info', 'delete', 'select']);
  });

  it('a photo: caption tools, Edit caption, no Check / Correct', () => {
    const p = { sender_id: 'me', content: '我的猫', attachment: { kind: 'image' } };
    const m = messageMenu(p, 'student', false, 'me');
    expect(m.items.find((i) => i.id === 'edit')?.label).toBe('Edit caption');
    expect(ids(m)).not.toContain('check');
    expect(ids(messageMenu({ ...p, sender_id: 'them' }, 'tutor', false, 'me'))).not.toContain('correct');
    expect(ids(messageMenu({ sender_id: 'them', content: '', attachment: { kind: 'image' } }, 'student', false, 'me'))).toEqual(['reply', 'forward', 'pin', 'info', 'select']);
  });

  it('deleted: nothing; pending: Copy only, no reactions', () => {
    expect(messageMenu({ ...base, deleted_at: 'x' }, 'student', false, 'me')).toEqual({ reactions: false, items: [] });
    expect(messageMenu({ ...base, pending: true }, 'student', false, 'me')).toEqual({ reactions: false, items: [{ id: 'copy', label: 'Copy', icon: '📋', needsInternet: false }] });
  });

  it('the Claude practice chat: Word by word, no pin / edit / delete / corrections', () => {
    expect(ids(messageMenu(base, 'tutor', true, 'me'))).toEqual(['reply', 'copy', 'translate', 'pinyin', 'explain', 'save_card', 'select_cards', 'play', 'word_by_word', 'discuss', 'select']);
    expect(ids(messageMenu({ ...base, sender_id: 'me' }, 'tutor', true, 'me'))).toContain('check');
  });
});

describe('bubbles', () => {
  const t0 = Date.parse('2026-10-02T09:00:00.000Z');
  const at = (ms: number) => new Date(t0 + ms).toISOString();
  const msgs = [
    { id: 'a', sender_id: 'them', created_at: at(0) },
    { id: 'b', sender_id: 'them', created_at: at(60_000) },
    { id: 'c', sender_id: 'them', created_at: at(60_000 + GROUP_GAP_MS + 1) },
    { id: 'd', sender_id: 'me', created_at: at(400_000) },
    { id: 'e', sender_id: 'me', created_at: at(401_000), pending: 'sending' as const },
    { id: 'f', sender_id: 'me', created_at: at(402_000), pending: 'failed' as const },
    { id: 'g', sender_id: 'me', created_at: at(20 * 3600_000) },
  ];

  it('groups by sender within the gap and the day, with ticks', () => {
    const l = layoutBubbles(msgs, 'me', at(400_000), 0);
    expect(l.map((x) => [x.id, x.firstInGroup, x.lastInGroup, x.newDay, x.tick])).toEqual([
      ['a', true, false, true, 'none'],
      ['b', false, true, false, 'none'],
      ['c', true, true, false, 'none'],
      ['d', true, false, false, 'read'],
      ['e', false, false, false, 'pending'],
      ['f', false, true, false, 'failed'],
      ['g', true, true, true, 'sent'],
    ]);
  });

  it('local days follow the offset', () => {
    expect(localDay('2026-10-02T23:30:00.000Z', 0)).toBe('2026-10-02');
    expect(localDay('2026-10-02T23:30:00.000Z', 60)).toBe('2026-10-03');
    expect(localDay('2026-10-02T00:30:00.000Z', -60)).toBe('2026-10-01');
    expect(localDay('nope', 0)).toBe('');
    expect(tickFor({ id: 'x', sender_id: 'me', created_at: at(0), deleted_at: 'y' }, 'me', null)).toBe('none');
  });

  it('firstLink', () => {
    expect(firstLink('Here: https://en.wikipedia.org/wiki/Chinese_cuisine.')).toBe('https://en.wikipedia.org/wiki/Chinese_cuisine');
    expect(firstLink('看这个https://example.com/a?b=1，很好')).toBe('https://example.com/a?b=1');
    expect(firstLink('(see https://en.wikipedia.org/wiki/Tea_(drink))')).toBe('https://en.wikipedia.org/wiki/Tea_(drink)');
    expect(firstLink('no link here')).toBeNull();
    expect(firstLink('http://localhost')).toBeNull();
    expect(firstLink('HTTPS://Example.com/x!')).toBe('HTTPS://Example.com/x');
  });
});
