import { describe, expect, it } from 'vitest';
import {
  applyIncomingMessage,
  applyReadMarker,
  chatInitial,
  chatMessagePreview,
  chatRelativeTime,
  chatRowPreview,
  chatRowTitle,
  filterChatList,
  groupChatList,
  sortChatList,
  unreadConversationCount,
  type ChatListRow,
} from './inbox';

const ME = 'me';
function row(over: Partial<ChatListRow> & { conversation_id: string }): ChatListRow {
  return {
    relationship_id: 'rel-1',
    title: null,
    is_ai: false,
    other_user: { id: 'u-1', name: 'Minghui', picture_url: null },
    other_role: 'tutor',
    last_message: null,
    unread: 0,
    last_activity_at: '2026-10-01T10:00:00.000Z',
    ...over,
  };
}

describe('chatMessagePreview', () => {
  it('labels photos and voice messages, with captions', () => {
    expect(chatMessagePreview({ content: '你好' })).toBe('你好');
    expect(chatMessagePreview({ content: '', attachment_kind: 'image' })).toBe('📷 Photo');
    expect(chatMessagePreview({ content: ' 看! ', attachment_kind: 'image' })).toBe('📷 Photo: 看!');
    expect(chatMessagePreview({ content: '', attachment_kind: 'voice' })).toBe('🎤 Voice message');
    expect(chatMessagePreview({ content: 'x', deleted: true })).toBe('Message deleted');
    expect(chatMessagePreview({ content: '', attachment_kind: 'file', attachment_name: 'homework.pdf' })).toBe('📄 homework.pdf');
    expect(chatMessagePreview({ content: 'see p.2', attachment_kind: 'file', attachment_name: 'homework.pdf' })).toBe('📄 homework.pdf: see p.2');
    expect(chatMessagePreview({ content: '', attachment_kind: 'file' })).toBe('📄 File');
    expect(chatMessagePreview({ content: '', attachment_kind: 'video' })).toBe('🎬 Video');
  });
});

describe('chatRelativeTime', () => {
  const now = Date.parse('2026-10-03T12:00:00.000Z'); // Sat 3 Oct 2026
  it('today → HH:MM in local time', () => {
    expect(chatRelativeTime('2026-10-03T09:05:00.000Z', now, 0)).toBe('09:05');
    expect(chatRelativeTime('2026-10-03T09:05:00.000Z', now, 480)).toBe('17:05');
  });
  it('yesterday, weekday, date, date with year', () => {
    expect(chatRelativeTime('2026-10-02T23:59:00.000Z', now, 0)).toBe('Yesterday');
    expect(chatRelativeTime('2026-09-28T08:00:00.000Z', now, 0)).toBe('Mon');
    expect(chatRelativeTime('2026-09-26T08:00:00.000Z', now, 0)).toBe('26 Sep');
    expect(chatRelativeTime('2025-09-28T08:00:00.000Z', now, 0)).toBe('28 Sep 2025');
  });
  it('the day boundary follows the offset', () => {
    // 23:30 UTC on the 2nd is 07:30 on the 3rd in UTC+8 → today
    expect(chatRelativeTime('2026-10-02T23:30:00.000Z', now, 480)).toBe('07:30');
    // and 01:00 UTC on the 3rd is still the 2nd in UTC-5 → yesterday
    expect(chatRelativeTime('2026-10-03T01:00:00.000Z', now, -300)).toBe('Yesterday');
  });
  it('future (skew) is today; garbage is empty', () => {
    expect(chatRelativeTime('2026-10-03T12:01:00.000Z', now, 0)).toBe('12:01');
    expect(chatRelativeTime('nope', now, 0)).toBe('');
  });
});

describe('rows', () => {
  const rows = [
    row({ conversation_id: 'a', title: 'Homework', last_activity_at: '2026-10-01T10:00:00.000Z' }),
    row({ conversation_id: 'b', title: null, last_activity_at: '2026-10-02T10:00:00.000Z' }),
    row({ conversation_id: 'c', relationship_id: 'rel-2', other_user: { id: 'u-2', name: 'Émile', picture_url: null }, other_role: 'student', last_activity_at: '2026-09-01T10:00:00.000Z' }),
  ];
  it('sorts newest first, stable by id', () => {
    expect(sortChatList(rows).map((r) => r.conversation_id)).toEqual(['b', 'a', 'c']);
    const tie = [row({ conversation_id: 'z' }), row({ conversation_id: 'y' })];
    expect(sortChatList(tie).map((r) => r.conversation_id)).toEqual(['y', 'z']);
  });
  it('a person is just their name (one chat per pair); Claude chats show a title when several', () => {
    expect(chatRowTitle(rows[0], rows)).toEqual({ name: 'Minghui', subtitle: null });
    expect(chatRowTitle(rows[2], rows)).toEqual({ name: 'Émile', subtitle: null });
    expect(chatRowTitle(row({ conversation_id: 'x', other_user: { id: 'q', name: '  ', picture_url: null } }), [])).toEqual({ name: 'Someone', subtitle: null });
    const ai = [
      row({ conversation_id: 'p1', relationship_id: 'rel-ai', is_ai: true, title: 'At the café', other_user: { id: 'claude-ai', name: 'Claude', picture_url: null } }),
      row({ conversation_id: 'p2', relationship_id: 'rel-ai', is_ai: true, title: null, other_user: { id: 'claude-ai', name: 'Claude', picture_url: null } }),
    ];
    expect(chatRowTitle(ai[0], ai)).toEqual({ name: 'Claude', subtitle: 'At the café' });
    expect(chatRowTitle(ai[1], ai)).toEqual({ name: 'Claude', subtitle: 'Chat' });
    expect(chatRowTitle(ai[0], [ai[0]])).toEqual({ name: 'Claude', subtitle: null });
  });
  it('initial', () => {
    expect(chatInitial({ name: 'minghui' })).toBe('M');
    expect(chatInitial({ name: '李明' })).toBe('李');
    expect(chatInitial({ name: null })).toBe('S');
  });
  it('preview: You: for mine, placeholder for empty', () => {
    const mine = row({ conversation_id: 'm', last_message: { id: '1', sender_id: ME, preview: 'see\nyou', created_at: 'x' } });
    const theirs = row({ conversation_id: 't', last_message: { id: '1', sender_id: 'u-1', preview: '🎤 Voice message', created_at: 'x' } });
    expect(chatRowPreview(mine, ME)).toBe('You: see you');
    expect(chatRowPreview(theirs, ME)).toBe('🎤 Voice message');
    expect(chatRowPreview(row({ conversation_id: 'e' }), ME)).toBe('No messages yet');
  });
  it('search by name (accent-free), title and last message', () => {
    const withMsg = [...rows, row({ conversation_id: 'd', last_message: { id: '1', sender_id: 'u-1', preview: '明天见', created_at: 'x' } })];
    expect(filterChatList(withMsg, 'emile').map((r) => r.conversation_id)).toEqual(['c']);
    expect(filterChatList(withMsg, 'home').map((r) => r.conversation_id)).toEqual(['a']);
    expect(filterChatList(withMsg, '明天').map((r) => r.conversation_id)).toEqual(['d']);
    expect(filterChatList(withMsg, 'minghui home').map((r) => r.conversation_id)).toEqual(['a']);
    expect(filterChatList(withMsg, '  ')).toHaveLength(4);
  });
  it('unread badge counts conversations with people only', () => {
    expect(unreadConversationCount([row({ conversation_id: '1', unread: 3 }), row({ conversation_id: '2', unread: 1 }), row({ conversation_id: '3', unread: 2, is_ai: true }), row({ conversation_id: '4' })])).toBe(2);
  });
  it('groups Claude chats apart', () => {
    const g = groupChatList([row({ conversation_id: 'p' }), row({ conversation_id: 'ai', is_ai: true })]);
    expect(g.people.map((r) => r.conversation_id)).toEqual(['p']);
    expect(g.practice.map((r) => r.conversation_id)).toEqual(['ai']);
  });
});

describe('live updates', () => {
  const rows = sortChatList([
    row({ conversation_id: 'a', unread: 0, last_activity_at: '2026-10-02T10:00:00.000Z', last_message: { id: 'm1', sender_id: ME, preview: 'hi', created_at: '2026-10-02T10:00:00.000Z' } }),
    row({ conversation_id: 'b', unread: 1, last_activity_at: '2026-10-01T10:00:00.000Z', last_message: { id: 'm0', sender_id: 'u-1', preview: 'yo', created_at: '2026-10-01T10:00:00.000Z' } }),
  ]);
  it('a message from them moves the row up and counts unread', () => {
    const next = applyIncomingMessage(rows, { id: 'm2', conversation_id: 'b', sender_id: 'u-1', preview: '在吗', created_at: '2026-10-03T08:00:00.000Z' }, ME)!;
    expect(next.map((r) => r.conversation_id)).toEqual(['b', 'a']);
    expect(next[0].unread).toBe(2);
    expect(next[0].last_message?.preview).toBe('在吗');
  });
  it('my own message clears unread', () => {
    const next = applyIncomingMessage(rows, { id: 'm3', conversation_id: 'b', sender_id: ME, preview: 'ok', created_at: '2026-10-03T08:00:00.000Z' }, ME)!;
    expect(next[0].unread).toBe(0);
  });
  it('the same message again only refreshes the preview', () => {
    const next = applyIncomingMessage(rows, { id: 'm1', conversation_id: 'a', sender_id: ME, preview: 'Message deleted', created_at: '2026-10-02T10:00:00.000Z' }, ME)!;
    expect(next[0].last_message?.preview).toBe('Message deleted');
    expect(next[0].unread).toBe(0);
  });
  it('unknown conversation → null (refetch)', () => {
    expect(applyIncomingMessage(rows, { id: 'z', conversation_id: 'zz', sender_id: 'u', preview: '', created_at: '' }, ME)).toBeNull();
  });
  it('read marker clears unread', () => {
    expect(applyReadMarker(rows, 'b').find((r) => r.conversation_id === 'b')?.unread).toBe(0);
  });
});
