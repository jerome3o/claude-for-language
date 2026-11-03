/**
 * The tutor's read-only view of her student's Claude chats (docs/CHAT.md "Claude threads" → "What your
 * tutor sees"; shared/claude/visibility.ts). Every read here filters with `tutorVisibleSql` — the SQL
 * form of `tutorCanSee` — so a chat the student keeps private never leaves the store: a hidden thread
 * is "not found", exactly like one that doesn't exist.
 *
 * What the tutor gets is the chat's own words, trimmed (`TutorClaudeThread` / `TutorClaudeMessage`):
 * never the check of his own Chinese, client ids, leases, the summary / memory, nor — the other way
 * round — anything of hers (her private student profile is never read here).
 *
 * Callers: routes/claude-tutor-view.ts, routes/claude-chats.ts (the older `/claude-chats` + the card hub's
 * questions for the tutor, served from visible card threads), routes/tutor-dashboard.ts (Asked Claude today).
 */
import type { TutorClaudeMessage, TutorClaudeThread } from '@shared/claude/api';
import { contextBadge, parseIntent, parseStoredContext, type StoredClaudeContext } from '@shared/claude/context';
import { parseTutorVisibility, type ClaudeTutorVisibility } from '@shared/claude/visibility';
import { sqliteToIso } from '@shared/chats/threads';
import { ensureClaudeThreadsBackfilled } from './backfill';

/** `tutorCanSee` in SQL over a thread row aliased `alias` (the setting is one of three known words). */
export function tutorVisibleSql(setting: ClaudeTutorVisibility, alias = 'c'): string {
  const v = `${alias}.tutor_visible`;
  switch (setting) {
    case 'all':
      return `(${v} IS NULL OR ${v} = 1)`;
    case 'none':
      return `${v} = 1`;
    default:
      return `(${v} = 1 OR (${v} IS NULL AND ${alias}.context_kind = 'card'))`;
  }
}

export async function getTutorVisibility(db: D1Database, userId: string): Promise<ClaudeTutorVisibility> {
  const row = await db.prepare('SELECT claude_tutor_visibility AS v FROM users WHERE id = ?').bind(userId).first<{ v: string | null }>();
  return parseTutorVisibility(row?.v ?? null);
}

/** null = back to the default. */
export async function setTutorVisibility(db: D1Database, userId: string, value: ClaudeTutorVisibility | null): Promise<ClaudeTutorVisibility> {
  await db.prepare('UPDATE users SET claude_tutor_visibility = ? WHERE id = ?').bind(value, userId).run();
  return parseTutorVisibility(value);
}

/** A finished, non-empty message (what the tutor reads; a reply being written / failed is left out). */
const DONE = `m.status IS NULL AND m.content != '' AND m.content_type IN ('text', 'analysis')`;

interface TutorThreadRow {
  id: string;
  title: string;
  context_kind: string | null;
  context_json: string | null;
  tutor_visible: number | null;
  preview: string | null;
  last_message_at: string | null;
  changed_at: string | null;
  created_at: string;
  message_count: number;
  first_intent: string | null;
  action: string | null;
}

const THREAD_SELECT = `
  SELECT c.id, c.title, c.context_kind, c.context_json, c.tutor_visible, c.preview, c.last_message_at, c.changed_at,
         c.created_at, c.action,
         (SELECT COUNT(*) FROM coach_messages m WHERE m.conversation_id = c.id AND ${DONE}) AS message_count,
         (SELECT m.intent FROM coach_messages m WHERE m.conversation_id = c.id AND m.role = 'user' ORDER BY m.created_at ASC, m.rowid ASC LIMIT 1) AS first_intent
  FROM coach_conversations c`;

/** Only what the chip needs: no chat / message ids, no Claude persona voice. */
function tutorContext(ctx: StoredClaudeContext): StoredClaudeContext {
  const snapshot = { ...(ctx.label ? { label: ctx.label } : {}), ...(ctx.sublabel ? { sublabel: ctx.sublabel } : {}) };
  switch (ctx.kind) {
    case 'card':
      return { kind: 'card', note_id: ctx.note_id, ...(ctx.card_type ? { card_type: ctx.card_type } : {}), ...snapshot };
    case 'practice':
      return {
        kind: 'practice',
        ...(ctx.scenario ? { scenario: ctx.scenario } : {}),
        ...(ctx.ai_role ? { ai_role: ctx.ai_role } : {}),
        ...(ctx.user_role ? { user_role: ctx.user_role } : {}),
        ...(ctx.level ? { level: ctx.level } : {}),
        ...snapshot,
      };
    case 'chat_message':
      return { kind: 'chat_message', message_id: '', ...snapshot };
    case 'reader':
      return { kind: 'reader', reader_id: ctx.reader_id, ...(ctx.page ? { page: ctx.page } : {}), ...snapshot };
    case 'exercise':
      return { kind: 'exercise', lesson_id: ctx.lesson_id, exercise_key: ctx.exercise_key, ...(ctx.exercise_type ? { exercise_type: ctx.exercise_type } : {}), ...snapshot };
    default:
      return { kind: 'general', ...snapshot };
  }
}

function toTutorThread(row: TutorThreadRow): TutorClaudeThread {
  const stored = parseStoredContext(row.context_kind, row.context_json);
  const context = tutorContext(stored);
  const intent = parseIntent(row.first_intent) ?? parseIntent(row.action);
  return {
    id: row.id,
    title: row.title,
    context_kind: context.kind,
    context,
    badge: contextBadge(stored, intent),
    preview: row.preview ?? null,
    last_message_at: row.last_message_at ?? (row.changed_at || null),
    created_at: sqliteToIso(row.created_at),
    message_count: Number(row.message_count) || 0,
    shared: row.tutor_visible === 1,
  };
}

export interface TutorThreadList {
  threads: TutorClaudeThread[];
  visibility: ClaudeTutorVisibility;
  total: number;
  next_cursor: string | null;
}

export const TUTOR_THREAD_PAGE_MAX = 200;

/**
 * The student's chats his tutor may read, newest activity first (only chats with something said in
 * them). The older Claude chats are copied in first (once per student), so a student still on an
 * older app shows the card questions he always showed.
 */
export async function listTutorThreads(
  db: D1Database,
  studentId: string,
  opts: { limit?: number; before?: string | null; noteId?: string | null } = {},
): Promise<TutorThreadList> {
  await ensureClaudeThreadsBackfilled(db, studentId).catch((err) => console.error('[tutor-view] backfill failed', err instanceof Error ? err.message : err));
  const visibility = await getTutorVisibility(db, studentId);
  const limit = Math.max(1, Math.min(TUTOR_THREAD_PAGE_MAX, Math.floor(opts.limit ?? 50)));
  const where = ['c.user_id = ?', 'c.deleted_at IS NULL', tutorVisibleSql(visibility), `EXISTS (SELECT 1 FROM coach_messages m WHERE m.conversation_id = c.id AND ${DONE})`];
  const params: unknown[] = [studentId];
  if (opts.noteId) {
    where.push("c.context_kind = 'card' AND c.context_ref = ?");
    params.push(opts.noteId);
  }
  const sortKey = 'COALESCE(c.last_message_at, c.changed_at)';
  const countWhere = [...where];
  const countParams = [...params];
  if (opts.before) {
    where.push(`${sortKey} < ?`);
    params.push(opts.before);
  }
  const [rows, total] = await db.batch<Record<string, unknown>>([
    db.prepare(`${THREAD_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${sortKey} DESC, c.rowid DESC LIMIT ?`).bind(...params, limit + 1),
    db.prepare(`SELECT COUNT(*) AS n FROM coach_conversations c WHERE ${countWhere.join(' AND ')}`).bind(...countParams),
  ]);
  const all = ((rows.results ?? []) as unknown as TutorThreadRow[]).map(toTutorThread);
  const hasMore = all.length > limit;
  const page = hasMore ? all.slice(0, limit) : all;
  return {
    threads: page,
    visibility,
    total: Number((total.results?.[0] as { n?: number } | undefined)?.n ?? page.length),
    next_cursor: hasMore ? page[page.length - 1].last_message_at : null,
  };
}

interface TutorMessageRow {
  id: string;
  role: 'user' | 'assistant';
  content_type: string;
  content: string;
  answer_lang: string | null;
  translation: string | null;
  tool_results: string | null;
  created_at: string;
}

/** One chat the tutor may read, read-only; null = missing, deleted OR private (never said which). */
export async function getTutorThread(db: D1Database, studentId: string, threadId: string): Promise<{ thread: TutorClaudeThread; messages: TutorClaudeMessage[] } | null> {
  const visibility = await getTutorVisibility(db, studentId);
  const row = await db
    .prepare(`${THREAD_SELECT} WHERE c.id = ? AND c.user_id = ? AND c.deleted_at IS NULL AND ${tutorVisibleSql(visibility)}`)
    .bind(threadId, studentId)
    .first<TutorThreadRow>();
  if (!row) return null;
  const res = await db
    .prepare(
      `SELECT m.id, m.role, m.content_type, m.content, m.answer_lang, m.translation, m.tool_results, m.created_at
         FROM coach_messages m WHERE m.conversation_id = ? AND ${DONE}
        ORDER BY m.created_at ASC, m.rowid ASC LIMIT 500`,
    )
    .bind(threadId)
    .all<TutorMessageRow>();
  return {
    thread: toTutorThread(row),
    messages: (res.results ?? []).map((m) => ({
      id: m.id,
      role: m.role,
      content_type: m.content_type === 'analysis' ? 'analysis' : 'text',
      content: m.content,
      answer_lang: m.answer_lang === 'zh' || m.answer_lang === 'en' ? m.answer_lang : null,
      translation: m.translation ?? null,
      tool_results: m.tool_results ?? null,
      created_at: sqliteToIso(m.created_at),
    })),
  };
}

/** The older `/claude-chats` row shape (one Q&A on a card). */
export interface TutorCardQuestion {
  id: string;
  note_id: string;
  question: string;
  answer: string;
  asked_at: string;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
}

interface CardQuestionRow extends Omit<TutorCardQuestion, 'answer'> {
  legacy_id: string | null;
  answer: string | null;
}

/**
 * The tutor's `/claude-chats` and card hub `questions` for apps from before the thread view: the
 * VISIBLE card threads' questions, each with the reply after it, in the old row shape (the old id —
 * the note_questions id — where the question came from there). Newest first; `before` = an asked_at.
 */
export async function tutorCardQuestions(
  db: D1Database,
  studentId: string,
  opts: { limit?: number; before?: string | null; noteId?: string | null } = {},
): Promise<{ questions: TutorCardQuestion[]; next_cursor: string | null; total: number }> {
  await ensureClaudeThreadsBackfilled(db, studentId).catch((err) => console.error('[tutor-view] backfill failed', err instanceof Error ? err.message : err));
  const visibility = await getTutorVisibility(db, studentId);
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? 100), 1), 500);
  const where = [
    'c.user_id = ?1',
    'd.user_id = ?1',
    'c.deleted_at IS NULL',
    "c.context_kind = 'card'",
    tutorVisibleSql(visibility),
    "u.role = 'user'",
    "u.status IS NULL AND u.content != ''",
  ];
  const params: unknown[] = [studentId];
  if (opts.noteId) {
    params.push(opts.noteId);
    where.push(`c.context_ref = ?${params.length}`);
  }
  const from = `FROM coach_messages u
    JOIN coach_conversations c ON c.id = u.conversation_id
    JOIN notes n ON n.id = c.context_ref
    JOIN decks d ON d.id = n.deck_id`;
  const countSql = `SELECT COUNT(*) AS n ${from} WHERE ${where.join(' AND ')}`;
  const countParams = [...params];
  if (opts.before) {
    params.push(opts.before.replace('T', ' ').replace(/(\.\d+)?Z$/, ''));
    where.push(`u.created_at < ?${params.length}`);
  }
  params.push(limit + 1);
  const [rows, total] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT u.id, u.legacy_id, u.content AS question, u.created_at AS asked_at, c.context_ref AS note_id,
                (SELECT a.content FROM coach_messages a
                  WHERE a.conversation_id = u.conversation_id AND a.role = 'assistant' AND a.status IS NULL AND a.content_type = 'text'
                    AND (a.created_at > u.created_at OR (a.created_at = u.created_at AND a.rowid > u.rowid))
                  ORDER BY a.created_at ASC, a.rowid ASC LIMIT 1) AS answer,
                n.hanzi, n.pinyin, n.english, d.id AS deck_id, d.name AS deck_name
           ${from}
          WHERE ${where.join(' AND ')}
          ORDER BY u.created_at DESC, u.rowid DESC LIMIT ?${params.length}`,
      )
      .bind(...params),
    db.prepare(countSql).bind(...countParams),
  ]);
  const all = ((rows.results ?? []) as unknown as CardQuestionRow[]).map((r) => ({
    id: r.legacy_id || r.id,
    note_id: r.note_id,
    question: r.question,
    answer: r.answer ?? '',
    asked_at: sqliteToIso(r.asked_at),
    hanzi: r.hanzi,
    pinyin: r.pinyin,
    english: r.english,
    deck_id: r.deck_id,
    deck_name: r.deck_name,
  }));
  const hasMore = all.length > limit;
  const page = hasMore ? all.slice(0, limit) : all;
  return {
    questions: page.filter((q) => q.answer),
    next_cursor: hasMore ? page[page.length - 1].asked_at : null,
    total: Number((total.results?.[0] as { n?: number } | undefined)?.n ?? page.length),
  };
}

/** How many of the student's chats the tutor may read had something said in them since `sinceIso`. */
export async function tutorThreadsActiveSince(db: D1Database, studentId: string, sinceIso: string): Promise<number> {
  const visibility = await getTutorVisibility(db, studentId);
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM coach_conversations c
        WHERE c.user_id = ? AND c.deleted_at IS NULL AND ${tutorVisibleSql(visibility)}
          AND EXISTS (SELECT 1 FROM coach_messages m WHERE m.conversation_id = c.id AND m.role = 'user'
                      AND m.created_at >= datetime(?))`,
    )
    .bind(studentId, sinceIso)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}
