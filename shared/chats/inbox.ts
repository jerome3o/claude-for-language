/**
 * The Chats inbox (the Chats tab, web `/chats`, Lab `ui/chats`): one row per
 * conversation across every relationship, Signal / WhatsApp style. Pure rules
 * shared by both apps — the Lab port is `core/…/chat/ChatInbox.kt`,
 * parity-tested (android-lab/parity/fixtures/chat-inbox.ts).
 *
 * Rows come from `GET /api/me/chats` (one query) and are cached on the device,
 * so the list renders instantly offline.
 */

export interface ChatListPerson {
  id: string;
  name: string | null;
  picture_url: string | null;
}

export interface ChatListLastMessage {
  id: string;
  sender_id: string;
  /** The server's one-line preview: the text, "📷 Photo", "🎤 Voice message" (+ caption), "Message deleted". */
  preview: string;
  created_at: string;
  /** 'image' | 'voice' | 'file' | 'video' when the message has an attachment (listening mode leaves those visible). */
  attachment_kind?: string | null;
}

export interface ChatListRow {
  conversation_id: string;
  relationship_id: string;
  title: string | null;
  /** A Claude role-play chat (listed in its own section). */
  is_ai: boolean;
  other_user: ChatListPerson;
  /** The other person's role towards me: 'tutor' = they teach me, 'student' = I teach them. */
  other_role: 'tutor' | 'student';
  last_message: ChatListLastMessage | null;
  /** Messages from the other person after my read marker. */
  unread: number;
  /** My read marker in this conversation (listening mode: an undecided setting hides what's unread). */
  my_read_at?: string | null;
  /** Newest message time, else when the conversation was made. */
  last_activity_at: string;
}

export interface ChatListResponse {
  server_time: string;
  conversations: ChatListRow[];
}

export type ChatPreviewKind = 'image' | 'voice' | 'file' | 'video';

const PREVIEW_LABEL: Record<ChatPreviewKind, string> = { image: '📷 Photo', voice: '🎤 Voice message', file: '📄 File', video: '🎬 Video' };

/**
 * The one-line text for a message — notifications, the inbox, the live update
 * of a row: the text, "📷 Photo" / "🎤 Voice message" / "📄 <file name>" /
 * "🎬 Video" (+ ": caption"), or
 * "Message deleted". The server's `messagePreviewText` is this function.
 */
export function chatMessagePreview(message: {
  content: string;
  attachment_kind?: ChatPreviewKind | null;
  /** A file's name (kind 'file'). */
  attachment_name?: string | null;
  deleted?: boolean;
  /** A photo album's photo count (docs/CHAT.md "Photo albums"): 2 or more → "📷 3 photos". */
  album_count?: number | null;
}): string {
  if (message.deleted) return 'Message deleted';
  const kind = message.attachment_kind;
  if (!kind || !(kind in PREVIEW_LABEL)) return message.content;
  const caption = message.content.trim();
  const photos = kind === 'image' ? albumPhotoCount(message.album_count) : 1;
  const label = photos > 1 ? `📷 ${photos} photos` : kind === 'file' && message.attachment_name ? `📄 ${message.attachment_name}` : PREVIEW_LABEL[kind];
  return caption ? `${label}: ${caption}` : label;
}

function albumPhotoCount(count: number | null | undefined): number {
  return typeof count === 'number' && Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
}

/** Newest activity first; ties by conversation id so the order is stable. */
export function sortChatList<T extends Pick<ChatListRow, 'last_activity_at' | 'conversation_id'>>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const ta = Date.parse(a.last_activity_at) || 0;
    const tb = Date.parse(b.last_activity_at) || 0;
    if (tb !== ta) return tb - ta;
    return a.conversation_id < b.conversation_id ? -1 : a.conversation_id > b.conversation_id ? 1 : 0;
  });
}

/** The name shown for a person ("Someone" when the account has none). */
export function chatPersonName(person: Pick<ChatListPerson, 'name'>): string {
  const n = (person.name ?? '').trim();
  return n || 'Someone';
}

/** The round avatar's letter when there is no picture. */
export function chatInitial(person: Pick<ChatListPerson, 'name'>): string {
  const n = chatPersonName(person);
  const first = Array.from(n)[0] ?? '?';
  return first.toUpperCase();
}

/**
 * Row heading: the person. A chat with a person never has a title — there is
 * one chat per pair (docs/CHAT.md "One chat per pair"). Only Claude practice
 * chats, which may be several, show their title when there is more than one.
 */
export function chatRowTitle(
  row: Pick<ChatListRow, 'other_user' | 'title' | 'relationship_id' | 'is_ai'>,
  rows: readonly Pick<ChatListRow, 'relationship_id'>[],
): {
  name: string;
  subtitle: string | null;
} {
  const name = chatPersonName(row.other_user);
  if (!row.is_ai) return { name, subtitle: null };
  const many = rows.filter((r) => r.relationship_id === row.relationship_id).length > 1;
  const title = (row.title ?? '').trim();
  return { name, subtitle: many ? title || 'Chat' : null };
}

/** The one-line preview: "You: …" for my own last message, "No messages yet" for an empty chat. */
export function chatRowPreview(row: Pick<ChatListRow, 'last_message'>, myUserId: string): string {
  const m = row.last_message;
  if (!m) return 'No messages yet';
  const text = m.preview.replace(/\s+/g, ' ').trim();
  return m.sender_id === myUserId ? `You: ${text}` : text;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Relative time on a row: "14:32" today, "Yesterday", the weekday within the
 * last 6 days ("Mon"), "28 Sep" this year, "28 Sep 2025" before. Local time is
 * the instant shifted by `offsetMinutes` (minutes EAST of UTC, i.e.
 * `-new Date(t).getTimezoneOffset()`), so the rule is deterministic and the
 * same in both apps. A time in the future (clock skew) shows as today.
 */
export function chatRelativeTime(iso: string, nowMs: number, offsetMinutes: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const shift = offsetMinutes * 60_000;
  const local = new Date(t + shift);
  const nowLocal = new Date(nowMs + shift);
  const dayOf = (d: Date) => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY_MS);
  const days = dayOf(nowLocal) - dayOf(local);
  if (days <= 0) return `${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return WEEKDAYS[local.getUTCDay()];
  const dm = `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]}`;
  return local.getUTCFullYear() === nowLocal.getUTCFullYear() ? dm : `${dm} ${local.getUTCFullYear()}`;
}

function fold(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Search: every word of the query must appear in the person's name, the title (Claude chats) or the last message. */
export function filterChatList<T extends Pick<ChatListRow, 'other_user' | 'title' | 'last_message'>>(rows: readonly T[], query: string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...rows];
  return rows.filter((r) => {
    const hay = fold([r.other_user.name ?? '', r.title ?? '', r.last_message?.preview ?? ''].join('\n'));
    return words.every((w) => hay.includes(w));
  });
}

/** The tab badge: how many conversations (with people, not Claude) have unread messages. */
export function unreadConversationCount(rows: readonly Pick<ChatListRow, 'unread' | 'is_ai'>[]): number {
  return rows.filter((r) => !r.is_ai && r.unread > 0).length;
}

/** People first, Claude role-play chats in their own section; each newest first. */
export function groupChatList<T extends Pick<ChatListRow, 'is_ai' | 'last_activity_at' | 'conversation_id'>>(rows: readonly T[]): {
  people: T[];
  practice: T[];
} {
  const sorted = sortChatList(rows);
  return { people: sorted.filter((r) => !r.is_ai), practice: sorted.filter((r) => r.is_ai) };
}

/**
 * A live `message` event for a listed conversation: the row moves to the top
 * with the new preview, and its unread count goes up when the message is from
 * the other person and the chat isn't on screen. Unknown conversation → null
 * (the caller refetches).
 */
export function applyIncomingMessage<T extends ChatListRow>(
  rows: readonly T[],
  msg: { id: string; conversation_id: string; sender_id: string; preview: string; created_at: string; attachment_kind?: string | null },
  myUserId: string,
): T[] | null {
  const idx = rows.findIndex((r) => r.conversation_id === msg.conversation_id);
  if (idx < 0) return null;
  const row = rows[idx];
  if (row.last_message?.id === msg.id) {
    // Same message again (an edit, a duplicate frame): refresh the preview only.
    const next = [...rows];
    next[idx] = { ...row, last_message: { ...row.last_message, preview: msg.preview } };
    return next;
  }
  const isNewer = !row.last_message || Date.parse(msg.created_at) >= Date.parse(row.last_message.created_at);
  const updated: T = {
    ...row,
    last_message: isNewer
      ? { id: msg.id, sender_id: msg.sender_id, preview: msg.preview, created_at: msg.created_at, attachment_kind: msg.attachment_kind ?? null }
      : row.last_message,
    last_activity_at: isNewer ? msg.created_at : row.last_activity_at,
    unread: msg.sender_id !== myUserId ? row.unread + 1 : 0,
  };
  const next = [...rows];
  next[idx] = updated;
  return sortChatList(next);
}

/** A `read` event (me on another device, or opening the chat here): that conversation has nothing unread. */
export function applyReadMarker<T extends ChatListRow>(rows: readonly T[], conversationId: string): T[] {
  return rows.map((r) => (r.conversation_id === conversationId && r.unread !== 0 ? { ...r, unread: 0 } : r));
}
