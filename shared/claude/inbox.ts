/**
 * The unified Chats tab (docs/CHAT.md "Chats tab — one list for people and Claude"; the
 * unified-Claude-chats plan §2.5 / §6.1 / §6.6): the chats with people (`GET /api/me/chats`,
 * shared/chats/inbox.ts) and the Claude threads (`GET /api/claude/threads`, cached on the device)
 * merged by one pure rule, `mergeInbox`, then split by `inboxSections`:
 *
 * - the people first (tutors / students — persistent chats, one per person), a learner's UNREAD tutor
 *   chats pinned on top; then a thin divider; then the Claude chats, newest first. The sections and the
 *   avatars (a photo / ✦) carry the kind — never colour (Jerome is red / green colour-blind);
 *   `inboxRowLabel` gives the word for screen readers;
 * - a Claude row is ONE compact line: ✦, its title, ONE context emoji (📇 card, 📖 reader, 🧩 exercise,
 *   🎭 practice, 💬 message, ✏️ check, 🔍 explain, 🔤 translate — `ContextBadge.icon`) that opens the
 *   full text ("Asked on card · 银行") and, when it has a target, "Open card ›" (`contextOpenLabel`);
 *   no preview line — only `claudeRowStatus` (waiting / writing / failed) when there is one;
 * - an old Claude practice chat (an `is_ai` conversation) shows ONCE: as its practice thread when the
 *   device has it, else as a Claude row of its own (opening the old chat) — never also as a person;
 * - archived threads are left out. No filter chips (Nov 2026: the sections replace them).
 *
 * The tutor's view (a tutor account / an account with students) is the same: her students first,
 * the divider, her Claude chats (no pinning).
 *
 * Pure; the Lab app's port is core `claude/ClaudeInbox.kt`, parity-tested
 * (android-lab/parity/fixtures/claude-chats.ts → ClaudeChatsParityTest).
 */
import { chatPersonName, type ChatListRow } from '../chats/inbox';
import type { ClaudeThreadSummary } from './api';
import { contextBadge, type ContextBadge } from './context';

export type InboxRowKind = 'tutor' | 'student' | 'claude';

/** A Claude thread as the inbox needs it (a `ClaudeThreadSummary`, or the device's copy of one). */
export type InboxThread = Pick<
  ClaudeThreadSummary,
  'id' | 'title' | 'context_kind' | 'context' | 'first_intent' | 'preview' | 'last_message_at' | 'created_at' | 'unread' | 'pending' | 'failed' | 'archived'
> & {
  /** Started on this device without a connection, not on the server yet. */
  local?: boolean;
};

/** A chat with a person, as `GET /api/me/chats` lists it. */
export type InboxHuman = Pick<ChatListRow, 'conversation_id' | 'relationship_id' | 'title' | 'is_ai' | 'other_user' | 'other_role' | 'last_message' | 'unread' | 'last_activity_at'>;

export interface InboxItem<H extends InboxHuman = InboxHuman, T extends InboxThread = InboxThread> {
  /** `h:<conversation id>` / `c:<thread id>` — stable, unique. */
  key: string;
  kind: InboxRowKind;
  /** ISO: the row's newest activity (the sort key). */
  activity_at: string;
  unread: number;
  /** A learner's unread chat with a tutor: on top. */
  pinned: boolean;
  /** A Claude row's context chip, null for a plain chat and for people. */
  badge: ContextBadge | null;
  /** A chat with a person — or an old practice chat with no thread on the device (a Claude row). */
  human: H | null;
  thread: T | null;
}

export interface MergeInboxOptions {
  /** Pin unread tutor chats on top (the learner's list; off in the tutor's student-centric view). */
  pinUnreadTutors?: boolean;
}

function timeOf(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function compareItems(a: InboxItem<InboxHuman, InboxThread>, b: InboxItem<InboxHuman, InboxThread>): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  const ta = timeOf(a.activity_at);
  const tb = timeOf(b.activity_at);
  if (tb !== ta) return tb - ta;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** A thread's newest activity: its last message, else when it was made. */
export function threadActivityAt(t: Pick<InboxThread, 'last_message_at' | 'created_at'>): string {
  return t.last_message_at || t.created_at;
}

/**
 * The one list: people and Claude, newest activity first, a learner's unread tutor chats pinned on
 * top (`pinUnreadTutors`). Archived threads are left out. An `is_ai` conversation (an old Claude
 * practice chat) is a Claude row — dropped when a practice thread for that conversation exists
 * (archived or not), so it never shows twice. Ties: the key.
 */
export function mergeInbox<H extends InboxHuman, T extends InboxThread>(
  humans: readonly H[],
  threads: readonly T[],
  opts: MergeInboxOptions = {},
): InboxItem<H, T>[] {
  const practiceConversations = new Set<string>();
  for (const t of threads) {
    if (t.context.kind === 'practice' && t.context.conversation_id) practiceConversations.add(t.context.conversation_id);
  }
  const items: InboxItem<H, T>[] = [];
  for (const h of humans) {
    if (h.is_ai) {
      if (practiceConversations.has(h.conversation_id)) continue;
      const title = (h.title ?? '').trim();
      items.push({
        key: `h:${h.conversation_id}`,
        kind: 'claude',
        activity_at: h.last_activity_at,
        unread: Math.max(0, h.unread),
        pinned: false,
        badge: contextBadge({ kind: 'practice', conversation_id: h.conversation_id, ...(title ? { label: title } : {}) }),
        human: h,
        thread: null,
      });
      continue;
    }
    const kind: InboxRowKind = h.other_role === 'student' ? 'student' : 'tutor';
    const unread = Math.max(0, h.unread);
    items.push({
      key: `h:${h.conversation_id}`,
      kind,
      activity_at: h.last_activity_at,
      unread,
      pinned: !!opts.pinUnreadTutors && kind === 'tutor' && unread > 0,
      badge: null,
      human: h,
      thread: null,
    });
  }
  for (const t of threads) {
    if (t.archived) continue;
    items.push({
      key: `c:${t.id}`,
      kind: 'claude',
      activity_at: threadActivityAt(t),
      unread: Math.max(0, t.unread),
      pinned: false,
      badge: contextBadge(t.context, t.first_intent),
      human: null,
      thread: t,
    });
  }
  return items.sort(compareItems);
}

// ---------- Labels ----------

export interface InboxRowLabel {
  icon: string;
  text: string;
}

/** The kind in words, for screen readers (the sections + avatars show it): 🧑‍🏫 Tutor · 🎓 Student · ✦ Claude. */
export function inboxRowLabel(kind: InboxRowKind): InboxRowLabel {
  switch (kind) {
    case 'tutor':
      return { icon: '🧑‍🏫', text: 'Tutor' };
    case 'student':
      return { icon: '🎓', text: 'Student' };
    default:
      return { icon: '✦', text: 'Claude' };
  }
}

/** A row's heading: the person, or the thread's title (an old practice chat: its title, else the person). */
export function inboxRowName(item: Pick<InboxItem, 'kind' | 'human' | 'thread'>): string {
  if (item.thread) return item.thread.title.trim() || 'Chat with Claude';
  const h = item.human!;
  if (item.kind === 'claude') return (h.title ?? '').trim() || 'Practice with Claude';
  return chatPersonName(h.other_user);
}

export interface ClaudeRowStatus {
  icon: string;
  /** In the row, where the time goes: "Writing…". */
  short: string;
  /** For screen readers / the tooltip. */
  text: string;
}

export const CLAUDE_ROW_QUEUED: ClaudeRowStatus = { icon: '🕓', short: 'Waiting', text: 'Waiting for a connection' };
export const CLAUDE_ROW_WRITING: ClaudeRowStatus = { icon: '✦', short: 'Writing…', text: 'Claude is writing a reply' };
export const CLAUDE_ROW_FAILED: ClaudeRowStatus = { icon: '⚠', short: 'Failed', text: 'The reply failed — open to retry' };

/**
 * A Claude row's state, shown in place of its time (the rows carry no preview line): waiting for a
 * connection (started offline), Claude writing, a failed reply — else null (the time shows).
 */
export function claudeRowStatus(t: Pick<InboxThread, 'pending' | 'failed' | 'local'>): ClaudeRowStatus | null {
  if (t.local) return CLAUDE_ROW_QUEUED;
  if (t.pending) return CLAUDE_ROW_WRITING;
  if (t.failed) return CLAUDE_ROW_FAILED;
  return null;
}

/** The context emoji's popover action, by where the chat happened (headerChipFor's link kind). */
export function contextOpenLabel(linkKind: string | null | undefined): string | null {
  switch (linkKind) {
    case 'card':
      return 'Open card';
    case 'reader':
      return 'Open story';
    case 'exercise':
      return 'Open lesson';
    default:
      return null;
  }
}

function fold(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Search: every word of the query in the row's name, its preview or its context chip. */
export function filterInbox<I extends InboxItem<InboxHuman, InboxThread>>(items: readonly I[], query: string): I[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...items];
  return items.filter((i) => {
    const parts = [inboxRowName(i), i.badge?.text ?? ''];
    if (i.thread) parts.push(i.thread.preview ?? '');
    if (i.human) parts.push(i.human.other_user.name ?? '', i.human.title ?? '', i.human.last_message?.preview ?? '');
    const hay = fold(parts.join('\n'));
    return words.every((w) => hay.includes(w));
  });
}

// ---------- Sections ----------

export interface InboxSections<I> {
  /** Tutors / students (a learner's unread tutor chats first, as merged). */
  people: I[];
  /** The Claude chats, newest first — below a thin divider. */
  claude: I[];
}

/** Both views: the people above (as merged), then the Claude chats. */
export function inboxSections<I extends Pick<InboxItem, 'kind'>>(items: readonly I[]): InboxSections<I> {
  return { people: items.filter((i) => i.kind !== 'claude'), claude: items.filter((i) => i.kind === 'claude') };
}
