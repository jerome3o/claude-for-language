/**
 * Golden vectors for the Chats inbox (shared/chats/inbox.ts): message previews, sorting (ties),
 * names / initials / row titles / row previews, relative time over many offsets (negative, day
 * boundaries, year change, skew, garbage), search (accents, Chinese, multi-word, full-width),
 * the tab badge count, grouping, and the live-update helpers.
 * Writes chat-inbox.json; checked by core/…/chat/ChatInboxParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyIncomingMessage,
  applyReadMarker,
  chatInitial,
  chatMessagePreview,
  chatPersonName,
  chatRelativeTime,
  chatRowPreview,
  chatRowTitle,
  filterChatList,
  groupChatList,
  sortChatList,
  unreadConversationCount,
  type ChatListRow,
} from '../../../shared/chats/inbox';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const ME = 'me';

// ---------- previews ----------
const previewInputs = [
  { content: '你好' },
  { content: '' },
  { content: '  spaced  ' },
  { content: '', attachment_kind: 'image' as const },
  { content: ' 看! ', attachment_kind: 'image' as const },
  { content: '', attachment_kind: 'voice' as const },
  { content: '我到了', attachment_kind: 'voice' as const },
  { content: '\n\t', attachment_kind: 'voice' as const },
  { content: 'x', deleted: true },
  { content: '', attachment_kind: 'image' as const, deleted: true },
  { content: 'hi', attachment_kind: null },
  { content: 'hi', deleted: false },
  { content: '　全角　', attachment_kind: 'image' as const },
];
const previews = previewInputs.map((input) => ({ input, result: chatMessagePreview(input) }));

// ---------- names / initials ----------
const names = [null, '', '   ', 'Minghui', ' minghui ', '明慧', 'ébé', 'ǆemal', 'ßtraße', '😀 Smile', '　老师', '𠀀abc', 'İsmail', 'ÿ'];
const people = names.map((name) => ({ name, display: chatPersonName({ name }), initial: chatInitial({ name }) }));

// ---------- rows ----------
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
const rows: ChatListRow[] = [
  row({ conversation_id: 'c-b', title: 'Homework', unread: 2, last_activity_at: '2026-10-03T08:00:00.000Z',
    last_message: { id: 'm1', sender_id: 'u-1', preview: '你做完作业了吗？', created_at: '2026-10-03T08:00:00.000Z' } }),
  row({ conversation_id: 'c-a', title: '  ', last_activity_at: '2026-10-03T08:00:00.000Z',
    last_message: { id: 'm2', sender_id: ME, preview: 'See you\n tomorrow  at   9', created_at: '2026-10-03T08:00:00.000Z' } }),
  row({ conversation_id: 'c-c', relationship_id: 'rel-2', other_user: { id: 'u-2', name: 'Zoë Café', picture_url: '/api/audio/avatars/u-2/x.jpg' }, other_role: 'student',
    last_activity_at: '2026-09-30T23:30:00.000Z', unread: 0,
    last_message: { id: 'm3', sender_id: 'u-2', preview: '📷 Photo: 我的猫', created_at: '2026-09-30T23:30:00.000Z' } }),
  row({ conversation_id: 'c-d', relationship_id: 'rel-3', is_ai: true, title: 'At the café', other_user: { id: 'claude', name: 'Claude', picture_url: null },
    last_activity_at: '2026-10-02T12:00:00.000Z', unread: 3,
    last_message: { id: 'm4', sender_id: 'claude', preview: '您好！要喝点什么？', created_at: '2026-10-02T12:00:00.000Z' } }),
  row({ conversation_id: 'c-e', relationship_id: 'rel-4', other_user: { id: 'u-4', name: null, picture_url: null }, last_activity_at: 'garbage', unread: 1 }),
  row({ conversation_id: 'c-f', relationship_id: 'rel-2', title: null, other_user: { id: 'u-2', name: 'Zoë Café', picture_url: null }, other_role: 'student',
    last_activity_at: '2025-12-31T23:59:59.000Z', unread: 0,
    last_message: { id: 'm5', sender_id: ME, preview: '🎤 Voice message', created_at: '2025-12-31T23:59:59.000Z' } }),
  row({ conversation_id: 'c-g', relationship_id: 'rel-5', is_ai: true, other_user: { id: 'claude', name: 'Claude', picture_url: null },
    last_activity_at: '2026-10-02T12:00:00.000Z', unread: 0 }),
  row({ conversation_id: 'c-0', relationship_id: 'rel-6', other_user: { id: 'u-6', name: '王老师', picture_url: null },
    last_activity_at: '2026-10-03T08:00:00.000+00:00', unread: 5,
    last_message: { id: 'm6', sender_id: 'u-6', preview: 'Message deleted', created_at: '2026-10-03T08:00:00.000+00:00' } }),
];

const sorted = sortChatList(rows).map((r) => r.conversation_id);
const grouped = groupChatList(rows);
const group = { people: grouped.people.map((r) => r.conversation_id), practice: grouped.practice.map((r) => r.conversation_id) };
const titles = rows.map((r) => chatRowTitle(r, rows));
const rowPreviews = rows.map((r) => chatRowPreview(r, ME));
const unreadCount = unreadConversationCount(rows);
const unreadCounts = [[], rows.slice(0, 1), rows.slice(3, 5), rows.filter((r) => r.is_ai)].map((rs) => unreadConversationCount(rs));

// ---------- relative time ----------
const nows = [
  '2026-10-03T12:00:00.000Z', // Sat
  '2026-10-03T00:10:00.000Z',
  '2026-01-01T03:00:00.000Z', // year change
  '2026-12-31T23:30:00.000Z',
  '2024-03-01T10:00:00.000Z', // leap year
];
const times = [
  '2026-10-03T09:05:00.000Z', '2026-10-03T11:59:59.999Z', '2026-10-03T12:00:00.000Z', '2026-10-03T13:00:00.000Z', '2026-10-04T08:00:00.000Z',
  '2026-10-02T23:59:00.000Z', '2026-10-02T23:30:00.000Z', '2026-10-03T01:00:00.000Z', '2026-10-02T00:00:00.000Z', '2026-09-28T08:00:00.000Z',
  '2026-09-27T08:00:00.000Z', '2026-09-26T08:00:00.000Z', '2026-09-26T23:59:00.000Z', '2025-09-28T08:00:00.000Z', '2025-12-31T23:30:00.000Z',
  '2025-12-31T20:00:00.000Z', '2026-01-01T00:30:00.000Z', '2025-12-25T10:00:00.000Z', '2026-12-31T22:00:00.000Z', '2027-01-01T05:00:00.000Z',
  '2026-12-25T10:00:00.000Z', '2024-02-29T10:00:00.000Z', '2024-02-28T23:00:00.000Z', '2023-03-01T10:00:00.000Z', '2024-02-23T09:00:00.000Z',
  '2026-10-03T08:00:00.000+08:00', '2026-10-03T08:00:00.000-05:00', '2026-10-03T08:00:00Z', 'garbage', '',
];
const offsets = [0, 60, 480, 330, 345, 840, -60, -300, -480, -600, -720, 780];
const relative: unknown[] = [];
for (const now of nows)
  for (const iso of times)
    for (const off of offsets) relative.push({ iso, now: Date.parse(now), off, result: chatRelativeTime(iso, Date.parse(now), off) });

// ---------- search ----------
const queries = [
  '', '   ', 'minghui', 'MING', 'zoe', 'zoë', 'cafe', 'CAFÉ', '猫', '作业', 'homework', 'home work', 'see tomorrow', 'tomorrow see',
  'tomorrow 9', 'you\ntomorrow', 'photo', '📷', 'voice', 'deleted', '王', '老师', 'claude', 'claude café', 'nope', 'm', 'c-a',
  '　作业', 'ｍｉｎｇ', 'ﬁ', 'é', 'é',
];
const search = queries.map((q) => ({ query: q, ids: filterChatList(rows, q).map((r) => r.conversation_id) }));

// ---------- live updates ----------
const incoming = [
  { id: 'n1', conversation_id: 'c-c', sender_id: 'u-2', preview: '好的', created_at: '2026-10-03T13:00:00.000Z' },
  { id: 'n2', conversation_id: 'c-b', sender_id: ME, preview: '做完了', created_at: '2026-10-03T13:00:00.000Z' },
  { id: 'm1', conversation_id: 'c-b', sender_id: 'u-1', preview: '你做完作业了吗？（edited）', created_at: '2026-10-03T08:00:00.000Z' },
  { id: 'n3', conversation_id: 'c-b', sender_id: 'u-1', preview: 'older', created_at: '2026-10-01T00:00:00.000Z' },
  { id: 'n4', conversation_id: 'c-e', sender_id: 'u-4', preview: 'first!', created_at: '2026-10-03T14:00:00.000Z' },
  { id: 'n5', conversation_id: 'missing', sender_id: 'u-1', preview: 'x', created_at: '2026-10-03T14:00:00.000Z' },
  { id: 'n6', conversation_id: 'c-a', sender_id: 'u-1', preview: 'same time', created_at: '2026-10-03T08:00:00.000Z' },
  { id: 'n7', conversation_id: 'c-f', sender_id: 'u-2', preview: 'bad date', created_at: 'garbage' },
  { id: 'n8', conversation_id: 'c-0', sender_id: ME, preview: 'mine', created_at: '2026-10-03T07:00:00.000Z' },
];
const live = incoming.map((msg) => ({ msg, result: applyIncomingMessage(rows, msg, ME) }));
const reads = ['c-b', 'c-c', 'missing', 'c-d'].map((id) => ({ id, result: applyReadMarker(rows, id) }));

writeFileSync(
  join(OUT, 'chat-inbox.json'),
  JSON.stringify({ previews, people, rows, sorted, group, titles, rowPreviews, unreadCount, unreadCounts, relative, search, live, reads }),
);
