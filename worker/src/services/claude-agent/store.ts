/**
 * Claude threads — ALL the SQL on the thread store (docs/CHAT.md "Claude threads"). Storage names:
 * `coach_conversations` (a thread) / `coach_messages` (its messages) — the Sentence Coach's tables,
 * evolved by migration 0144 (context descriptor, inbox fields, client ids, intents, a lease for the
 * reply being written). A future rename of the tables is a change to this file only.
 *
 * Timestamps: `created_at` stays SQLite's `datetime('now')` (seconds; message order = created_at,
 * then rowid); the new columns are ISO with milliseconds (`NOW_ISO`) so `?since=` cursors and leases
 * compare as strings.
 *
 * Callers outside services/claude-agent: routes/claude-threads.ts, coach-replies (touch on finish),
 * db/queries.ts addCoachMessage (touch), routes/ask-claude.ts (the card thread's dual-write).
 */
import type { ClaudeThreadMessage, ClaudeThreadSummary } from '@shared/claude/api';
import {
  contextBadge,
  contextRef,
  parseIntent,
  parseStoredContext,
  type ClaudeContextKind,
  type ClaudeIntent,
  type ClaudeThreadContext,
  type ClaudeContextSnapshot,
} from '@shared/claude/context';
import { sqliteToIso } from '@shared/chats/threads';

/** SQLite's now as ISO with milliseconds ("2026-11-03T10:00:00.123Z"). */
export const NOW_ISO = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

/** How long a runner holds a reply it is writing before a watchdog may take it over. */
export const TURN_LEASE_SECONDS = 40;

// ---------- Rows ----------

export interface ThreadRow {
  id: string;
  user_id: string;
  title: string;
  input_language: string;
  action: string | null;
  kind: string | null;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
  context_kind: string | null;
  context_ref: string | null;
  context_json: string | null;
  client_id: string | null;
  last_message_at: string | null;
  preview: string | null;
  unread: number;
  changed_at: string | null;
  summary: string | null;
  summary_upto: string | null;
  language: string | null;
  tutor_visible: number | null;
  read_only: number;
  archived_at: string | null;
  deleted_at: string | null;
  source: string | null;
  legacy_id: string | null;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content_type: string;
  content: string;
  tool_results: string | null;
  created_at: string;
  status: 'pending' | 'failed' | null;
  error: string | null;
  attempts: number;
  checkpoint: string | null;
  started_at: string | null;
  answer_lang: string | null;
  translation: string | null;
  client_id: string | null;
  intent: string | null;
  auto_check: string | null;
  meta: string | null;
  lease_until: string | null;
  updated_at: string | null;
  legacy_id: string | null;
}

type SummaryRow = ThreadRow & { pending_reply: number; failed_reply: number; first_intent: string | null };

const LEGACY_INTENTS = new Set(['check', 'explain', 'translate']);

/** The thread's first-message intent; Coach rows from before 0144 read it from `action` / `kind`. */
function firstIntentOf(row: Pick<SummaryRow, 'first_intent' | 'action' | 'kind'>): ClaudeIntent | null {
  const stored = parseIntent(row.first_intent);
  if (stored) return stored;
  if (row.kind === 'ask' || row.action === 'ask') return 'ask';
  return row.action && LEGACY_INTENTS.has(row.action) ? (row.action as ClaudeIntent) : null;
}

export function toThreadSummary(row: SummaryRow): ClaudeThreadSummary {
  const context = parseStoredContext(row.context_kind, row.context_json);
  const firstIntent = firstIntentOf(row);
  return {
    id: row.id,
    client_id: row.client_id ?? null,
    title: row.title,
    context_kind: context.kind,
    context,
    badge: contextBadge(context, firstIntent),
    first_intent: firstIntent,
    preview: row.preview ?? null,
    last_message_at: row.last_message_at ?? (row.updated_at ? sqliteToIso(row.updated_at) : null),
    created_at: sqliteToIso(row.created_at),
    unread: Number(row.unread) || 0,
    pending: !!row.pending_reply,
    failed: !!row.failed_reply,
    read_only: !!row.read_only,
    archived: !!row.archived_at,
    tutor_visible: row.tutor_visible === null || row.tutor_visible === undefined ? null : !!row.tutor_visible,
    language: row.language === 'zh' || row.language === 'en' ? row.language : null,
    source: row.source ?? null,
  };
}

export function toThreadMessage(row: MessageRow): ClaudeThreadMessage {
  const status = row.status === 'pending' || row.status === 'failed' ? row.status : null;
  return {
    id: row.id,
    thread_id: row.conversation_id,
    client_id: row.client_id ?? null,
    role: row.role,
    content_type: row.content_type,
    content: row.content ?? '',
    intent: parseIntent(row.intent),
    status,
    streaming: status === 'pending' && !!row.content,
    error: row.error ?? null,
    answer_lang: row.answer_lang === 'zh' || row.answer_lang === 'en' ? row.answer_lang : null,
    translation: row.translation ?? null,
    tool_results: row.tool_results ?? null,
    created_at: sqliteToIso(row.created_at),
    updated_at: row.updated_at ?? null,
  };
}

// ---------- Threads ----------

export interface NewThread {
  /** Default: a random UUID. Deterministic ids (`nq-…`, `pc-…`, `md-…`) make the backfill idempotent. */
  id?: string;
  userId: string;
  clientId?: string | null;
  context: ClaudeThreadContext;
  snapshot?: ClaudeContextSnapshot;
  title: string;
  /** Coach compatibility: older apps list general threads by `action` / `kind`. */
  action?: string | null;
  kind?: string | null;
  inputLanguage?: 'zh' | 'en';
  language?: 'zh' | 'en' | null;
  source: string;
  legacyId?: string | null;
  readOnly?: boolean;
  /** When it began (backfill: the first copied message's time; any format SQLite's datetime() reads). */
  createdAt?: string | null;
}

/** The INSERT of a thread (OR IGNORE: an existing id / client id / legacy key wins). */
export function insertThreadStatement(db: D1Database, t: NewThread): D1PreparedStatement {
  const id = t.id ?? crypto.randomUUID();
  const json = JSON.stringify({ ...t.context, ...(t.snapshot ?? {}) });
  return db
    .prepare(
      `INSERT OR IGNORE INTO coach_conversations
         (id, user_id, title, input_language, action, kind, context_kind, context_ref, context_json, client_id,
          language, source, legacy_id, read_only, created_at, updated_at, last_message_at, changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               COALESCE(datetime(?), datetime('now')), COALESCE(datetime(?), datetime('now')),
               COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', ?), ${NOW_ISO}), ${NOW_ISO})`,
    )
    .bind(
      id,
      t.userId,
      t.title,
      t.inputLanguage ?? 'zh',
      t.action ?? null,
      t.kind ?? null,
      t.context.kind,
      contextRef(t.context),
      json,
      t.clientId ?? null,
      t.language ?? null,
      t.source,
      t.legacyId ?? null,
      t.readOnly ? 1 : 0,
      t.createdAt ?? null,
      t.createdAt ?? null,
      t.createdAt ?? null,
    );
}

/** Creates a thread (idempotent by client id: the existing one comes back with `created: false`). */
export async function createThread(db: D1Database, t: NewThread): Promise<{ thread: ThreadRow; created: boolean }> {
  if (t.clientId) {
    const existing = await getThreadByClientId(db, t.userId, t.clientId);
    if (existing) return { thread: existing, created: false };
  }
  const id = t.id ?? crypto.randomUUID();
  const res = await insertThreadStatement(db, { ...t, id }).run();
  const created = (res.meta?.changes ?? 0) > 0;
  const thread = created ? await getThreadRow(db, t.userId, id) : t.clientId ? await getThreadByClientId(db, t.userId, t.clientId) : await getThreadRow(db, t.userId, id);
  if (!thread) throw new Error('Thread could not be created');
  return { thread, created };
}

export async function getThreadRow(db: D1Database, userId: string, id: string): Promise<ThreadRow | null> {
  return (await db.prepare('SELECT * FROM coach_conversations WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(id, userId).first<ThreadRow>()) ?? null;
}

export async function getThreadByClientId(db: D1Database, userId: string, clientId: string): Promise<ThreadRow | null> {
  return (await db.prepare('SELECT * FROM coach_conversations WHERE user_id = ? AND client_id = ? AND deleted_at IS NULL').bind(userId, clientId).first<ThreadRow>()) ?? null;
}

const SUMMARY_SELECT = `
  SELECT c.*,
    EXISTS (SELECT 1 FROM coach_messages m WHERE m.conversation_id = c.id AND m.status = 'pending') AS pending_reply,
    EXISTS (SELECT 1 FROM coach_messages m WHERE m.conversation_id = c.id AND m.status = 'failed') AS failed_reply,
    (SELECT m.intent FROM coach_messages m WHERE m.conversation_id = c.id AND m.role = 'user' ORDER BY m.created_at ASC, m.rowid ASC LIMIT 1) AS first_intent
  FROM coach_conversations c`;

export async function getThreadSummary(db: D1Database, userId: string, id: string): Promise<ClaudeThreadSummary | null> {
  const row = await db.prepare(`${SUMMARY_SELECT} WHERE c.id = ? AND c.user_id = ? AND c.deleted_at IS NULL`).bind(id, userId).first<SummaryRow>();
  return row ? toThreadSummary(row) : null;
}

export interface ListThreadsOptions {
  /** ISO: only threads changed at / after it (+ the ids deleted since). */
  since?: string | null;
  limit?: number;
  contextKind?: ClaudeContextKind | null;
  /** Card threads of one note. */
  noteId?: string | null;
  /** true = archived only; false (default) = not archived; null = both. */
  archived?: boolean | null;
}

export const THREAD_LIST_MAX = 200;

/** The inbox: newest activity first, with the badge data. */
export async function listThreads(
  db: D1Database,
  userId: string,
  opts: ListThreadsOptions = {},
): Promise<{ threads: ClaudeThreadSummary[]; deleted_ids: string[]; server_time: string }> {
  const where = ['c.user_id = ?', 'c.deleted_at IS NULL'];
  const params: unknown[] = [userId];
  if (opts.since) {
    where.push('c.changed_at >= ?');
    params.push(opts.since);
  }
  if (opts.noteId) {
    where.push("c.context_kind = 'card' AND c.context_ref = ?");
    params.push(opts.noteId);
  } else if (opts.contextKind) {
    if (opts.contextKind === 'general') where.push("(c.context_kind IS NULL OR c.context_kind = 'general')");
    else {
      where.push('c.context_kind = ?');
      params.push(opts.contextKind);
    }
  }
  const archived = opts.archived === undefined ? false : opts.archived;
  if (archived === true) where.push('c.archived_at IS NOT NULL');
  else if (archived === false) where.push('c.archived_at IS NULL');
  const limit = Math.max(1, Math.min(THREAD_LIST_MAX, Math.floor(opts.limit ?? 100)));
  const statements = [
    db.prepare(`SELECT ${NOW_ISO} AS now`),
    db
      .prepare(`${SUMMARY_SELECT} WHERE ${where.join(' AND ')} ORDER BY COALESCE(c.last_message_at, c.changed_at) DESC, c.rowid DESC LIMIT ?`)
      .bind(...params, limit),
  ];
  if (opts.since) {
    statements.push(db.prepare('SELECT id FROM coach_conversations WHERE user_id = ? AND deleted_at IS NOT NULL AND changed_at >= ?').bind(userId, opts.since));
  }
  const results = await db.batch<Record<string, unknown>>(statements);
  const now = String((results[0].results?.[0] as { now?: string } | undefined)?.now ?? new Date().toISOString());
  return {
    threads: ((results[1].results ?? []) as unknown as SummaryRow[]).map(toThreadSummary),
    deleted_ids: opts.since ? ((results[2]?.results ?? []) as Array<{ id: string }>).map((r) => r.id) : [],
    server_time: now,
  };
}

/** The most recent live card thread about a note (Ask Claude's "same chat within 30 min" rule). */
export async function latestCardThread(db: D1Database, userId: string, noteId: string): Promise<ThreadRow | null> {
  return (
    (await db
      .prepare(
        `SELECT * FROM coach_conversations
          WHERE user_id = ? AND context_kind = 'card' AND context_ref = ? AND deleted_at IS NULL
          ORDER BY COALESCE(last_message_at, changed_at) DESC LIMIT 1`,
      )
      .bind(userId, noteId)
      .first<ThreadRow>()) ?? null
  );
}

/**
 * Recomputes the inbox fields after a message changed: last_message_at, the preview (the newest
 * finished text message), changed_at; `+unread` when a reply just finished.
 */
export function touchThreadStatement(db: D1Database, threadId: string, unreadDelta = 0): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE coach_conversations SET
         last_message_at = COALESCE((SELECT strftime('%Y-%m-%dT%H:%M:%fZ', MAX(created_at)) FROM coach_messages WHERE conversation_id = ?1), last_message_at),
         preview = COALESCE((SELECT substr(trim(replace(replace(content, char(10), ' '), char(13), ' ')), 1, 120) FROM coach_messages
                              WHERE conversation_id = ?1 AND status IS NULL AND content_type = 'text' AND content != ''
                              ORDER BY created_at DESC, rowid DESC LIMIT 1), preview),
         unread = unread + ?2,
         updated_at = datetime('now'),
         changed_at = ${NOW_ISO}
       WHERE id = ?1`,
    )
    .bind(threadId, unreadDelta);
}

export async function touchThread(db: D1Database, threadId: string, unreadDelta = 0): Promise<void> {
  await touchThreadStatement(db, threadId, unreadDelta).run();
}

/** The thread was opened: its replies are seen. */
export async function markThreadRead(db: D1Database, userId: string, threadId: string): Promise<void> {
  await db.prepare(`UPDATE coach_conversations SET unread = 0, changed_at = ${NOW_ISO} WHERE id = ? AND user_id = ? AND unread > 0`).bind(threadId, userId).run();
}

export interface ThreadPatch {
  title?: string;
  archived?: boolean;
  tutor_visible?: boolean | null;
  language?: 'zh' | 'en' | null;
  read?: boolean;
}

export async function patchThread(db: D1Database, userId: string, threadId: string, patch: ThreadPatch): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push('title = ?');
    params.push(patch.title);
  }
  if (patch.archived !== undefined) sets.push(patch.archived ? `archived_at = COALESCE(archived_at, ${NOW_ISO})` : 'archived_at = NULL');
  if (patch.tutor_visible !== undefined) {
    sets.push('tutor_visible = ?');
    params.push(patch.tutor_visible === null ? null : patch.tutor_visible ? 1 : 0);
  }
  if (patch.language !== undefined) {
    sets.push('language = ?');
    params.push(patch.language);
  }
  if (patch.read) sets.push('unread = 0');
  if (sets.length === 0) return;
  sets.push(`changed_at = ${NOW_ISO}`);
  await db
    .prepare(`UPDATE coach_conversations SET ${sets.join(', ')} WHERE id = ? AND user_id = ? AND deleted_at IS NULL`)
    .bind(...params, threadId, userId)
    .run();
}

/**
 * Deletes a thread: its messages go, the row stays as a tombstone (no text left) so a `?since=` list
 * reports it and a re-run of the backfill never brings it back.
 */
export async function deleteThread(db: D1Database, userId: string, threadId: string): Promise<boolean> {
  const thread = await getThreadRow(db, userId, threadId);
  if (!thread) return false;
  await db.batch([
    db.prepare('DELETE FROM coach_messages WHERE conversation_id = ?').bind(threadId),
    db
      .prepare(
        `UPDATE coach_conversations SET deleted_at = ${NOW_ISO}, changed_at = ${NOW_ISO}, title = '', preview = NULL,
                context_json = NULL, summary = NULL, client_id = NULL, source_message_id = NULL
          WHERE id = ? AND user_id = ?`,
      )
      .bind(threadId, userId),
  ]);
  return true;
}

// ---------- Messages ----------

export interface NewMessage {
  id?: string;
  threadId: string;
  clientId?: string | null;
  role: 'user' | 'assistant';
  contentType?: 'text' | 'analysis' | 'mistake_lesson';
  content: string;
  intent?: ClaudeIntent | null;
  status?: 'pending' | null;
  answerLang?: 'zh' | 'en' | null;
  translation?: string | null;
  autoCheck?: string | null;
  toolResults?: string | null;
  legacyId?: string | null;
  /** Any format SQLite's datetime() reads (backfill); default now. */
  createdAt?: string | null;
}

/** The INSERT of a message (OR IGNORE: an existing id / client id / legacy key wins). */
export function insertMessageStatement(db: D1Database, m: NewMessage & { id: string }): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO coach_messages
         (id, conversation_id, role, content_type, content, tool_results, status, client_id, intent, answer_lang, translation,
          auto_check, legacy_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(datetime(?), datetime('now')), ${NOW_ISO})`,
    )
    .bind(
      m.id,
      m.threadId,
      m.role,
      m.contentType ?? 'text',
      m.content,
      m.toolResults ?? null,
      m.status ?? null,
      m.clientId ?? null,
      m.intent ?? null,
      m.answerLang ?? null,
      m.translation ?? null,
      m.autoCheck ?? null,
      m.legacyId ?? null,
      m.createdAt ?? null,
    );
}

/**
 * The learner's message + Claude's pending reply in ONE batch, the thread touched. Idempotent by the
 * learner message's client id: a resend returns the stored pair (`created: false`).
 */
export async function appendTurn(
  db: D1Database,
  user: NewMessage,
  reply: Omit<NewMessage, 'role' | 'content' | 'threadId'> & { contentType: 'text' | 'analysis' },
): Promise<{ user: MessageRow; reply: MessageRow | null; created: boolean }> {
  if (user.clientId) {
    const existing = await db.prepare('SELECT * FROM coach_messages WHERE conversation_id = ? AND client_id = ?').bind(user.threadId, user.clientId).first<MessageRow>();
    if (existing) {
      const after = await db
        .prepare(
          `SELECT * FROM coach_messages WHERE conversation_id = ? AND role = 'assistant'
              AND (created_at > ? OR (created_at = ? AND rowid > (SELECT rowid FROM coach_messages WHERE id = ?)))
            ORDER BY created_at ASC, rowid ASC LIMIT 1`,
        )
        .bind(user.threadId, existing.created_at, existing.created_at, existing.id)
        .first<MessageRow>();
      return { user: existing, reply: after ?? null, created: false };
    }
  }
  const userId = user.id ?? crypto.randomUUID();
  const replyId = reply.id ?? crypto.randomUUID();
  await db.batch([
    insertMessageStatement(db, { ...user, id: userId }),
    insertMessageStatement(db, { ...reply, id: replyId, threadId: user.threadId, role: 'assistant', content: '', status: 'pending' }),
    touchThreadStatement(db, user.threadId),
  ]);
  const rows = await getMessagesByIds(db, [userId, replyId]);
  const u = rows.find((r) => r.id === userId);
  if (!u) throw new Error('Message could not be stored');
  return { user: u, reply: rows.find((r) => r.id === replyId) ?? null, created: true };
}

export async function getMessagesByIds(db: D1Database, ids: string[]): Promise<MessageRow[]> {
  if (ids.length === 0) return [];
  const r = await db.prepare(`SELECT * FROM coach_messages WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<MessageRow>();
  return r.results ?? [];
}

/** A thread's messages in order; with `since` (ISO) only those written at / after it + every pending one. */
export async function getThreadMessages(db: D1Database, threadId: string, since?: string | null): Promise<MessageRow[]> {
  const r = since
    ? await db
        .prepare(`SELECT * FROM coach_messages WHERE conversation_id = ? AND (updated_at >= ? OR status = 'pending') ORDER BY created_at ASC, rowid ASC`)
        .bind(threadId, since)
        .all<MessageRow>()
    : await db.prepare('SELECT * FROM coach_messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC').bind(threadId).all<MessageRow>();
  return r.results ?? [];
}

export async function serverNowIso(db: D1Database): Promise<string> {
  const r = await db.prepare(`SELECT ${NOW_ISO} AS now`).first<{ now: string }>();
  return r?.now ?? new Date().toISOString();
}

/** A reply with its thread (what the turn runner needs). */
export type TurnRow = MessageRow & {
  t_user_id: string;
  t_context_kind: string | null;
  t_context_json: string | null;
  t_action: string | null;
  t_kind: string | null;
  t_read_only: number;
  t_deleted_at: string | null;
};

export async function getTurnRow(db: D1Database, messageId: string): Promise<TurnRow | null> {
  return (
    (await db
      .prepare(
        `SELECT m.*, c.user_id AS t_user_id, c.context_kind AS t_context_kind, c.context_json AS t_context_json,
                c.action AS t_action, c.kind AS t_kind, c.read_only AS t_read_only, c.deleted_at AS t_deleted_at
           FROM coach_messages m JOIN coach_conversations c ON c.id = m.conversation_id
          WHERE m.id = ?`,
      )
      .bind(messageId)
      .first<TurnRow>()) ?? null
  );
}

// ---------- The reply being written (lease, partial text, finish) ----------

const leaseUntil = (seconds: number) => `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+${Math.max(1, Math.floor(seconds))} seconds')`;

/**
 * Takes the reply to write it: only while it is pending and nobody holds an unexpired lease. Bumps
 * `attempts` / `started_at` (the stale sweep). false = done, failed, gone, or another runner has it.
 */
export async function claimTurn(db: D1Database, messageId: string, leaseSeconds = TURN_LEASE_SECONDS): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE coach_messages
          SET lease_until = ${leaseUntil(leaseSeconds)}, attempts = attempts + 1, started_at = datetime('now'), updated_at = ${NOW_ISO}
        WHERE id = ? AND role = 'assistant' AND status = 'pending'
          AND (lease_until IS NULL OR lease_until < ${NOW_ISO})`,
    )
    .bind(messageId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** The text so far (status stays 'pending'), the lease renewed. */
export async function writePartial(db: D1Database, messageId: string, text: string, leaseSeconds = TURN_LEASE_SECONDS): Promise<void> {
  await db
    .prepare(`UPDATE coach_messages SET content = ?, lease_until = ${leaseUntil(leaseSeconds)}, updated_at = ${NOW_ISO} WHERE id = ? AND status = 'pending'`)
    .bind(text, messageId)
    .run();
}

export async function renewLease(db: D1Database, messageId: string, leaseSeconds = TURN_LEASE_SECONDS): Promise<void> {
  await db.prepare(`UPDATE coach_messages SET lease_until = ${leaseUntil(leaseSeconds)} WHERE id = ? AND status = 'pending'`).bind(messageId).run();
}

/** Lets go of a reply (a retryable failure): the text so far cleared, the next runner may take it at once. */
export async function releaseTurn(db: D1Database, messageId: string): Promise<void> {
  await db.prepare(`UPDATE coach_messages SET lease_until = NULL, content = '', updated_at = ${NOW_ISO} WHERE id = ? AND status = 'pending'`).bind(messageId).run();
}

/**
 * Saves the model's answer + its tool actions before any action runs. Only the first save counts
 * (two runners racing): the stored checkpoint comes back, whoever wrote it.
 */
export async function saveTurnCheckpoint(db: D1Database, messageId: string, checkpoint: string, first = false): Promise<string | null> {
  if (first) {
    await db.prepare(`UPDATE coach_messages SET checkpoint = ? WHERE id = ? AND status = 'pending' AND checkpoint IS NULL`).bind(checkpoint, messageId).run();
    const row = await db.prepare('SELECT checkpoint FROM coach_messages WHERE id = ?').bind(messageId).first<{ checkpoint: string | null }>();
    return row?.checkpoint ?? null;
  }
  await db.prepare(`UPDATE coach_messages SET checkpoint = ? WHERE id = ? AND status = 'pending'`).bind(checkpoint, messageId).run();
  return checkpoint;
}

/** The reply is done: its text, tool results and meta; the thread's inbox fields (+1 unread). */
export async function finishTurn(
  db: D1Database,
  messageId: string,
  threadId: string,
  content: string,
  toolResults: string | null,
  meta: Record<string, unknown> | null,
): Promise<boolean> {
  const [res] = await db.batch([
    db
      .prepare(
        `UPDATE coach_messages SET content = ?, tool_results = ?, meta = ?, status = NULL, error = NULL, checkpoint = NULL,
                lease_until = NULL, updated_at = ${NOW_ISO}
          WHERE id = ? AND status = 'pending'`,
      )
      .bind(content, toolResults, meta ? JSON.stringify(meta) : null, messageId),
    touchThreadStatement(db, threadId, 1),
  ]);
  return ((res as D1Result).meta?.changes ?? 0) > 0;
}

export async function failTurn(db: D1Database, messageId: string, threadId: string, error: string): Promise<void> {
  await db.batch([
    db
      .prepare(`UPDATE coach_messages SET status = 'failed', error = ?, content = '', lease_until = NULL, updated_at = ${NOW_ISO} WHERE id = ? AND status = 'pending'`)
      .bind(error, messageId),
    touchThreadStatement(db, threadId),
  ]);
}

/** Retry: back to pending (the checkpoint kept so finished tool actions don't run twice). */
export async function reopenTurn(db: D1Database, messageId: string): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE coach_messages SET status = 'pending', error = NULL, attempts = 0, started_at = NULL, lease_until = NULL, content = '',
              updated_at = ${NOW_ISO}
        WHERE id = ? AND status = 'failed'`,
    )
    .bind(messageId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function setMessageLegacyId(db: D1Database, ids: string[], legacyId: string): Promise<void> {
  if (ids.length === 0) return;
  await db.prepare(`UPDATE coach_messages SET legacy_id = ? WHERE id IN (${ids.map(() => '?').join(',')}) AND legacy_id IS NULL`).bind(legacyId, ...ids).run();
}
