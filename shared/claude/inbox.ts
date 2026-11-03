/**
 * The unified Chats tab (docs/CHAT.md "Chats tab — one list for people and Claude"; the
 * unified-Claude-chats plan §2.5 / §6.1 / §6.6): the chats with people (`GET /api/me/chats`,
 * shared/chats/inbox.ts) and the Claude threads (`GET /api/claude/threads`, cached on the device)
 * merged into ONE list by one pure rule, `mergeInbox`:
 *
 * - every row is a `tutor`, a `student` or a `claude` row — the apps draw a tutor row with a blue
 *   outline + 🧑‍🏫 "Tutor", a Claude row with an orange outline + ✦ "Claude" and its context chip
 *   ("📇 Asked on card · 银行", "🎭 Practice · 点菜", "✏️ Check"…). Colour is never the only signal
 *   (Jerome is red / green colour-blind): `inboxRowLabel` gives the icon + the word;
 * - a learner's UNREAD tutor chats are pinned on top; everything else is newest activity first;
 * - an old Claude practice chat (an `is_ai` conversation) shows ONCE: as its practice thread when the
 *   device has it, else as a Claude row of its own (opening the old chat) — never also as a person;
 * - archived threads are left out; the filter chips are All · Tutor (People / Students) · Claude.
 *
 * The tutor's view (a tutor account / an account with students) is student-centric:
 * `teacherSections` = the people first, then "Your Claude chats" (collapsed by the app).
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

export type InboxFilter = 'all' | 'people' | 'claude';

export const INBOX_FILTERS: readonly InboxFilter[] = ['all', 'people', 'claude'];

export interface MergeInboxOptions {
  /** Pin unread tutor chats on top (the learner's list; off in the tutor's student-centric view). */
  pinUnreadTutors?: boolean;
  filter?: InboxFilter;
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

function matchesFilter(kind: InboxRowKind, filter: InboxFilter): boolean {
  if (filter === 'people') return kind !== 'claude';
  if (filter === 'claude') return kind === 'claude';
  return true;
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
  const filter = opts.filter ?? 'all';
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
  return items.filter((i) => matchesFilter(i.kind, filter)).sort(compareItems);
}

// ---------- Labels ----------

export interface InboxRowLabel {
  icon: string;
  text: string;
}

/** The word + icon on every row (never colour alone): 🧑‍🏫 Tutor · 🎓 Student · ✦ Claude. */
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

export const CLAUDE_ROW_WRITING = '✦ Writing a reply…';
export const CLAUDE_ROW_FAILED = '⚠ The reply failed — open to retry';
export const CLAUDE_ROW_QUEUED = '🕓 Waiting for a connection';

/**
 * A Claude row's preview line: waiting for a connection (started offline), Claude writing, a failed
 * reply, else the last message (one line) — nothing when that only repeats the title (a chat started
 * with ✏️ Check: its title IS the sentence).
 */
export function claudeRowPreview(t: Pick<InboxThread, 'preview' | 'pending' | 'failed' | 'local'> & { title?: string }): string {
  if (t.local) return CLAUDE_ROW_QUEUED;
  if (t.pending) return CLAUDE_ROW_WRITING;
  if (t.failed) return CLAUDE_ROW_FAILED;
  const line = (t.preview ?? '').replace(/\s+/g, ' ').trim();
  return t.title !== undefined && line === t.title.replace(/\s+/g, ' ').trim() ? '' : line;
}

// ---------- Filters ----------

export interface InboxFilterChip {
  id: InboxFilter;
  label: string;
}

/**
 * The filter chips: All · <people> · ✦ Claude — only when the list has both people and Claude (else
 * there is nothing to filter). The people chip says who they are: "Tutor" (one) / "Tutors",
 * "Students", or "People" when both.
 */
export function inboxFilters(items: readonly Pick<InboxItem, 'kind'>[]): InboxFilterChip[] {
  const tutors = items.filter((i) => i.kind === 'tutor').length;
  const students = items.filter((i) => i.kind === 'student').length;
  const claude = items.some((i) => i.kind === 'claude');
  if (!claude || tutors + students === 0) return [];
  const people = students === 0 ? (tutors === 1 ? '🧑‍🏫 Tutor' : '🧑‍🏫 Tutors') : tutors === 0 ? '🎓 Students' : 'People';
  return [
    { id: 'all', label: 'All' },
    { id: 'people', label: people },
    { id: 'claude', label: '✦ Claude' },
  ];
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

// ---------- The tutor's view ----------

/**
 * The tutor's Chats tab: the people above (her students — and her own tutor, if she has one — newest
 * first, as merged), then her own Claude chats.
 */
export function teacherSections<I extends Pick<InboxItem, 'kind'>>(items: readonly I[]): { people: I[]; claude: I[] } {
  return { people: items.filter((i) => i.kind !== 'claude'), claude: items.filter((i) => i.kind === 'claude') };
}

// ---------- The composer's "To:" ----------

export interface ComposeRecipient {
  relationship_id: string;
  conversation_id: string;
  name: string;
}

/**
 * Who the bottom box can go to besides Claude: each tutor I have a chat with (one per relationship,
 * newest chat first). Students are reached from their rows — the box is for Claude first.
 */
export function composeRecipients(humans: readonly InboxHuman[]): ComposeRecipient[] {
  const seen = new Set<string>();
  const out: ComposeRecipient[] = [];
  const sorted = [...humans].sort((a, b) => timeOf(b.last_activity_at) - timeOf(a.last_activity_at) || (a.conversation_id < b.conversation_id ? -1 : 1));
  for (const h of sorted) {
    if (h.is_ai || h.other_role !== 'tutor' || seen.has(h.relationship_id)) continue;
    seen.add(h.relationship_id);
    out.push({ relationship_id: h.relationship_id, conversation_id: h.conversation_id, name: chatPersonName(h.other_user) });
  }
  return out;
}
