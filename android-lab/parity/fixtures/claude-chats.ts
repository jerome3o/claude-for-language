/**
 * Claude threads' screen rules (shared/claude/contexts.ts + contextBadge in shared/claude/context.ts):
 * the suggestion chips per context, the composer's intent buttons, the header chip, which thread a
 * context resumes, the poll interval while a reply is written and the streaming status line.
 * Writes claude-chats.json; checked by core/…/claude/ClaudeChatsParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  chipsFor, claudeReplyPollMs, composerFor, headerChipFor, resumeThreadFor, turnStatusLine,
  CHIPS_AFTER_REPLY_MAX, CLAUDE_INTENT_LABELS, CLAUDE_LIVE_FRESH_MS, CLAUDE_POLL_FAST_FOR_MS, CLAUDE_POLL_FAST_MS, CLAUDE_POLL_SLOW_MS,
  PRACTICE_READ_ONLY_NOTE, RESUME_WINDOW_MS, type ResumeCandidate,
} from '../../../shared/claude/contexts';
import { contextBadge, type ClaudeIntent, type StoredClaudeContext } from '../../../shared/claude/context';
import {
  claudeRowPreview, composeRecipients, filterInbox, inboxFilters, inboxRowLabel, inboxRowName, mergeInbox, teacherSections,
  type InboxFilter, type InboxHuman, type InboxItem, type InboxThread,
} from '../../../shared/claude/inbox';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: claude-chats <out-dir>');
mkdirSync(OUT, { recursive: true });

/** A context as the Kotlin side takes it (flat). */
type FlatCtx = { kind: string; note_id?: string; message_id?: string; conversation_id?: string; scenario?: string; label?: string; typed?: boolean };
function stored(c: FlatCtx): StoredClaudeContext {
  switch (c.kind) {
    case 'card':
      return { kind: 'card', note_id: c.note_id!, ...(c.typed ? { typed: { answer: '银航' } } : {}), ...(c.label ? { label: c.label } : {}) };
    case 'practice':
      return { kind: 'practice', ...(c.conversation_id ? { conversation_id: c.conversation_id } : {}), ...(c.scenario ? { scenario: c.scenario } : {}), ...(c.label ? { label: c.label } : {}) };
    case 'chat_message':
      return { kind: 'chat_message', message_id: c.message_id!, ...(c.conversation_id ? { conversation_id: c.conversation_id } : {}), ...(c.label ? { label: c.label } : {}) };
    default:
      return { kind: 'general', ...(c.label ? { label: c.label } : {}) };
  }
}

const CTXS: FlatCtx[] = [
  { kind: 'general' },
  { kind: 'card', note_id: 'n1', label: '银行' },
  { kind: 'card', note_id: 'n1', typed: true },
  { kind: 'card', note_id: 'n2' },
  { kind: 'chat_message', message_id: 'm1', conversation_id: 'c1', label: '明天见！' },
  { kind: 'chat_message', message_id: 'm2' },
  { kind: 'practice', conversation_id: 'c9', scenario: '点菜' },
  { kind: 'practice', conversation_id: 'c9', scenario: '在餐厅里点菜，服务员问你要喝什么，你还想再要一碗米饭和一个汤，然后买单', label: 'x' },
  { kind: 'practice', conversation_id: 'c8', label: '服务员' },
  // A new role-play (no conversation): the help chips, Ask, never resumed.
  { kind: 'practice', scenario: '在饭店点菜', label: '在饭店点菜' },
];

const chips: unknown[] = [];
for (const ctx of CTXS) {
  for (const language of ['zh', 'en'] as const) {
    for (const typedAnswer of [false, true]) {
      for (const hasSentence of [false, true]) {
        for (const replies of [0, 1, 4]) {
          for (const used of [[], ['sentences', 'quiz', 'natural'], ['phrase', 'quiz', 'story']]) {
            chips.push({ ctx, language, typedAnswer, hasSentence, replies, used, out: chipsFor(stored(ctx), { language, typedAnswer, hasSentence, replies, used }) });
          }
        }
      }
    }
  }
}

const TEXTS = ['', '   ', '我昨天去了商店', '我想买iPhone', 'How do I say hello?', '　你好　', '123'];
const composers = ['general', 'card', 'chat_message', 'practice'].flatMap((kind) =>
  TEXTS.flatMap((text) => [false, true].flatMap((started) => [false, true].map((readOnly) => ({ kind, text, started, readOnly, out: composerFor(kind as 'general', text, { started, readOnly }) })))));

const badges = CTXS.flatMap((ctx) =>
  ([null, 'ask', 'check', 'explain', 'translate'] as (ClaudeIntent | null)[]).map((firstIntent) => ({ ctx, firstIntent, out: contextBadge(stored(ctx), firstIntent) })));
const headerChips = CTXS.map((ctx) => ({ ctx, out: headerChipFor(stored(ctx)) }));

const NOW = Date.parse('2026-11-03T10:00:00.000Z');
const iso = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();
type FlatThread = { id: string; ctx: FlatCtx; last_message_at: string | null; created_at: string; archived?: boolean };
const toCandidate = (t: FlatThread): ResumeCandidate => {
  const context = stored(t.ctx);
  return { id: t.id, context_kind: context.kind, context, last_message_at: t.last_message_at, created_at: t.created_at, archived: t.archived };
};
const card1 = { kind: 'card', note_id: 'n1' };
const THREADS: FlatThread[] = [
  { id: 'a', ctx: card1, last_message_at: iso(25), created_at: iso(200) },
  { id: 'b', ctx: card1, last_message_at: iso(5), created_at: iso(200) },
  { id: 'b2', ctx: card1, last_message_at: iso(5), created_at: iso(200) },
  { id: 'c', ctx: { kind: 'card', note_id: 'n2' }, last_message_at: iso(31), created_at: iso(40) },
  { id: 'd', ctx: { kind: 'card', note_id: 'n3' }, last_message_at: null, created_at: iso(10) },
  { id: 'e', ctx: { kind: 'card', note_id: 'n4' }, last_message_at: iso(1), created_at: iso(2), archived: true },
  { id: 'f', ctx: { kind: 'general' }, last_message_at: iso(1), created_at: iso(2) },
  { id: 'g', ctx: { kind: 'chat_message', message_id: 'm1', conversation_id: 'c1' }, last_message_at: iso(60 * 24 * 40), created_at: iso(60 * 24 * 41) },
  { id: 'h', ctx: { kind: 'practice', conversation_id: 'c9' }, last_message_at: 'not a date', created_at: iso(3) },
  { id: 'i', ctx: { kind: 'card', note_id: 'n5' }, last_message_at: iso(30), created_at: iso(31) },
  { id: 'j', ctx: { kind: 'practice', scenario: '点菜' }, last_message_at: iso(1), created_at: iso(2) },
];
const resumeQueries: FlatCtx[] = [card1, { kind: 'card', note_id: 'n2' }, { kind: 'card', note_id: 'n3' }, { kind: 'card', note_id: 'n4' }, { kind: 'card', note_id: 'n5' }, { kind: 'card', note_id: 'n9' }, { kind: 'general' }, { kind: 'chat_message', message_id: 'm1' }, { kind: 'practice', conversation_id: 'c9' }, { kind: 'practice', scenario: '点菜' }];
const resume = resumeQueries.map((ctx) => ({ ctx, out: resumeThreadFor(THREADS.map(toCandidate), stored(ctx), NOW) }));

const polls = [0, 399, 9_999, 10_000, 60_000].flatMap((pendingForMs) =>
  [null, { open: false, sinceEventMs: 100 }, { open: true, sinceEventMs: null }, { open: true, sinceEventMs: 0 }, { open: true, sinceEventMs: 2_999 }, { open: true, sinceEventMs: 3_000 }].map((live) => ({
    pendingForMs, live, out: claudeReplyPollMs(pendingForMs, live ?? undefined),
  })));

const statuses = (['thinking', 'tool', 'streaming', 'done', 'failed', null] as const).flatMap((status) =>
  [null, 'search_cards', 'get_deck_info', 'get_overall_stats', 'get_due_cards', 'bump_cards'].flatMap((tool) =>
    (['zh', 'en'] as const).map((language) => ({ status, tool, language, out: turnStatusLine(status, tool, language) }))));

// ---------- The unified Chats tab (shared/claude/inbox.ts) ----------

const person = (id: string, name: string | null) => ({ id, name, picture_url: null });
const HUMANS: InboxHuman[] = [
  { conversation_id: 'h1', relationship_id: 'r1', title: null, is_ai: false, other_user: person('u1', 'Minghui'), other_role: 'tutor', last_message: { id: 'm1', sender_id: 'u1', preview: '明天上课见！', created_at: iso(30) }, unread: 2, last_activity_at: iso(30) },
  { conversation_id: 'h2', relationship_id: 'r2', title: null, is_ai: false, other_user: person('u2', 'Lily'), other_role: 'student', last_message: { id: 'm2', sender_id: 'me', preview: '作业  做完了吗？', created_at: iso(5) }, unread: 4, last_activity_at: iso(5) },
  { conversation_id: 'h3', relationship_id: 'r3', title: null, is_ai: false, other_user: person('u3', null), other_role: 'tutor', last_message: null, unread: 0, last_activity_at: iso(60 * 24 * 3) },
  { conversation_id: 'h4', relationship_id: 'r1', title: '点菜', is_ai: true, other_user: person('claude', 'Claude'), other_role: 'tutor', last_message: { id: 'm4', sender_id: 'claude', preview: '您要喝什么？', created_at: iso(2) }, unread: 1, last_activity_at: iso(2) },
  { conversation_id: 'h5', relationship_id: 'r1', title: '  ', is_ai: true, other_user: person('claude', 'Claude'), other_role: 'tutor', last_message: null, unread: -3, last_activity_at: 'bad date' },
  { conversation_id: 'h6', relationship_id: 'r4', title: null, is_ai: false, other_user: person('u4', 'Laoshi Wang'), other_role: 'tutor', last_message: { id: 'm6', sender_id: 'u4', preview: '加油', created_at: iso(30) }, unread: 0, last_activity_at: iso(30) },
];
type FlatInboxThread = Omit<InboxThread, 'context' | 'context_kind'> & { ctx: FlatCtx };
const INBOX_THREADS: FlatInboxThread[] = [
  { id: 't1', title: '银行 和 行 的读音', ctx: { kind: 'card', note_id: 'n1', label: '银行' }, first_intent: 'ask', preview: '“行”在银行里\n读 háng。', last_message_at: iso(10), created_at: iso(12), unread: 1, pending: false, failed: false, archived: false },
  { id: 't2', title: '我昨天去了商店买东西了', ctx: { kind: 'general' }, first_intent: 'check', preview: null, last_message_at: null, created_at: iso(1), unread: 0, pending: true, failed: false, archived: false },
  { id: 't3', title: '', ctx: { kind: 'practice', conversation_id: 'h5', scenario: '买单' }, first_intent: null, preview: 'ok', last_message_at: iso(60 * 24 * 10), created_at: iso(60 * 24 * 11), unread: 0, pending: false, failed: false, archived: false },
  { id: 't4', title: 'Archived', ctx: { kind: 'general' }, first_intent: 'ask', preview: 'x', last_message_at: iso(0), created_at: iso(0), unread: 3, pending: false, failed: false, archived: true },
  { id: 't5', title: 'Hello in Chinese', ctx: { kind: 'chat_message', message_id: 'mm', conversation_id: 'h1', label: '明天见！' }, first_intent: 'ask', preview: 'Say 你好。', last_message_at: iso(30), created_at: iso(31), unread: 0, pending: false, failed: true, archived: false },
  { id: 't7', title: '我昨天  去了商店', ctx: { kind: 'general' }, first_intent: 'check', preview: '我昨天 去了商店', last_message_at: iso(40), created_at: iso(41), unread: 2, pending: false, failed: false, archived: false },
  { id: 't6', title: 'Queued', ctx: { kind: 'general' }, first_intent: 'explain', preview: 'q', last_message_at: iso(3), created_at: iso(3), unread: 0, pending: false, failed: false, archived: false, local: true },
];
const inboxThread = (t: FlatInboxThread): InboxThread => {
  const { ctx, ...rest } = t;
  const context = stored(ctx);
  return { ...rest, context_kind: context.kind, context };
};
const flatItem = (i: InboxItem) => ({
  key: i.key, kind: i.kind, activity_at: i.activity_at, unread: i.unread, pinned: i.pinned, badge: i.badge,
  name: inboxRowName(i), label: inboxRowLabel(i.kind),
  preview: i.thread ? claudeRowPreview(i.thread) : null,
});
const HUMAN_SETS: number[][] = [[0, 1, 2, 3, 4, 5], [0, 2, 5], [1], [3, 4], []];
const THREAD_SETS: number[][] = [[0, 1, 2, 3, 4, 5, 6], [0], [2], []];
const inbox: unknown[] = [];
for (const hs of HUMAN_SETS) {
  for (const ts of THREAD_SETS) {
    const humans = hs.map((i) => HUMANS[i]);
    const threads = ts.map((i) => inboxThread(INBOX_THREADS[i]));
    for (const pin of [false, true]) {
      for (const filter of ['all', 'people', 'claude'] as InboxFilter[]) {
        const items = mergeInbox(humans, threads, { pinUnreadTutors: pin, filter });
        inbox.push({
          humans: hs, threads: ts, pin, filter,
          items: items.map(flatItem),
          filters: inboxFilters(items),
          search: ['', 'minghui', 'asked card', 'hang', '作业', 'practice 买单', 'zzz'].map((q) => ({ q, keys: filterInbox(items, q).map((i) => i.key) })),
          teacher: (() => { const s = teacherSections(items); return { people: s.people.map((i) => i.key), claude: s.claude.map((i) => i.key) }; })(),
        });
      }
    }
  }
  inbox.push({ humans: hs, recipients: composeRecipients(hs.map((i) => HUMANS[i])) });
}

writeFileSync(
  join(OUT, 'claude-chats.json'),
  JSON.stringify({
    inboxHumans: HUMANS, inboxThreads: INBOX_THREADS, inbox,
    chips, composers, badges, headerChips, now: NOW, threads: THREADS, resume, polls, statuses,
    copy: {
      chipsAfterReplyMax: CHIPS_AFTER_REPLY_MAX, intentLabels: CLAUDE_INTENT_LABELS, practiceReadOnly: PRACTICE_READ_ONLY_NOTE, resumeWindowMs: RESUME_WINDOW_MS,
      pollFastMs: CLAUDE_POLL_FAST_MS, pollFastForMs: CLAUDE_POLL_FAST_FOR_MS, pollSlowMs: CLAUDE_POLL_SLOW_MS, liveFreshMs: CLAUDE_LIVE_FRESH_MS,
    },
  }, null, 1),
);
