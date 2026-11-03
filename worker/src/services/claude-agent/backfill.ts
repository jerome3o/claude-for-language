/**
 * Claude threads — the lazy, idempotent copy of the older Claude chats into the thread store
 * (docs/CHAT.md "Claude threads"; the unified-Claude-chats plan §2.4). Per user, on the first
 * `GET /api/claude/threads` (and the admin's `POST /api/admin/claude-threads/backfill`), stamped in
 * `users.claude_threads_backfilled_at`:
 *
 *   note_questions        → `card` threads, grouped like the apps always showed them
 *                           (`groupQuestionThreads`: one note's questions, each ≤ 30 min after the
 *                           previous); thread `nq-<first question id>`, messages `nq-<id>-q|a`
 *   Claude practice chats → `practice` threads (conversations.is_ai_conversation; READ-ONLY until the
 *                           practice provider lands); thread `pc-<conversation id>`, messages `pc-<id>`
 *   Discuss with Claude   → `chat_message` threads (message_discussions); thread `md-<discussion id>`,
 *                           messages `md-<id>-<index>`
 *   Coach / Ask chats     → already threads (migration 0144 marked them `general`)
 *
 * Idempotent: fixed ids + INSERT OR IGNORE + the legacy keys (`legacy_id`), so a re-run never
 * duplicates; a thread the learner deleted (a tombstone) is never brought back; a Q&A already copied
 * (by the dual-write) is found by its legacy id and its group's missing ones join THAT thread.
 * The old tables are untouched (older apps read them). After the backfill, new Q&As reach the threads
 * through the dual-writes: `appendCardQuestion` (POST /api/notes/:id/ask) and `syncDiscussionThread`
 * (PUT /api/messages/:id/discussion).
 */
import { groupQuestionThreads, sqliteToIso, THREAD_GAP_MS } from '@shared/chats/threads';
import { previewOf, titleFor, type ClaudeThreadContext, type ClaudeContextSnapshot } from '@shared/claude/context';
import type { Note } from '../../types';
import { insertMessageStatement, insertThreadStatement, latestCardThread, NOW_ISO, touchThreadStatement, type NewMessage } from './store';

/** Statements per `db.batch`. */
export const BACKFILL_BATCH = 80;

export interface BackfillCounts {
  card_threads: number;
  card_messages: number;
  practice_threads: number;
  practice_messages: number;
  discussion_threads: number;
  discussion_messages: number;
}

interface QuestionRow {
  id: string;
  note_id: string;
  question: string;
  answer: string;
  asked_at: string;
  answer_lang: string | null;
  answer_translation: string | null;
  question_translation: string | null;
  question_check: string | null;
  hanzi: string;
  deck_name: string | null;
}

interface PracticeRow {
  id: string;
  title: string | null;
  scenario: string | null;
  user_role: string | null;
  ai_role: string | null;
  voice_id: string | null;
  created_at: string | null;
}

interface PracticeMessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string | null;
}

interface DiscussionRow {
  id: string;
  message_id: string;
  messages_json: string;
  created_at: string | null;
  conversation_id: string;
  message_content: string;
}

const lang = (v: string | null | undefined): 'zh' | 'en' | null => (v === 'zh' || v === 'en' ? v : null);

/** Runs the backfill once per user (true = it ran now). */
export async function ensureClaudeThreadsBackfilled(db: D1Database, userId: string): Promise<boolean> {
  const row = await db.prepare('SELECT claude_threads_backfilled_at AS at FROM users WHERE id = ?').bind(userId).first<{ at: string | null }>();
  if (!row || row.at) return false;
  await backfillClaudeThreads(db, userId);
  return true;
}

/** Copies everything (again — idempotent) and stamps the user. */
export async function backfillClaudeThreads(db: D1Database, userId: string): Promise<BackfillCounts> {
  const counts: BackfillCounts = { card_threads: 0, card_messages: 0, practice_threads: 0, practice_messages: 0, discussion_threads: 0, discussion_messages: 0 };
  const [questions, copied, tombstones, practice, practiceMessages, discussions] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT q.id, q.note_id, q.question, q.answer, q.asked_at, q.answer_lang, q.answer_translation, q.question_translation,
                q.question_check, n.hanzi, d.name AS deck_name
           FROM note_questions q JOIN notes n ON n.id = q.note_id JOIN decks d ON d.id = n.deck_id
          WHERE d.user_id = ?`,
      )
      .bind(userId),
    db
      .prepare(
        `SELECT m.legacy_id, m.conversation_id FROM coach_messages m JOIN coach_conversations c ON c.id = m.conversation_id
          WHERE c.user_id = ? AND c.context_kind = 'card' AND c.deleted_at IS NULL AND m.role = 'user' AND m.legacy_id IS NOT NULL`,
      )
      .bind(userId),
    db.prepare('SELECT id FROM coach_conversations WHERE user_id = ? AND deleted_at IS NOT NULL').bind(userId),
    db
      .prepare(
        `SELECT c.id, c.title, c.scenario, c.user_role, c.ai_role, c.voice_id, c.created_at
           FROM conversations c JOIN tutor_relationships r ON r.id = c.relationship_id
          WHERE c.is_ai_conversation = 1
            AND ((r.requester_id = ?1 AND r.recipient_id = 'claude-ai') OR (r.recipient_id = ?1 AND r.requester_id = 'claude-ai'))`,
      )
      .bind(userId),
    db
      .prepare(
        `SELECT m.id, m.conversation_id, m.sender_id, m.content, m.created_at FROM messages m
          WHERE m.deleted_at IS NULL AND m.conversation_id IN (
            SELECT c.id FROM conversations c JOIN tutor_relationships r ON r.id = c.relationship_id
             WHERE c.is_ai_conversation = 1
               AND ((r.requester_id = ?1 AND r.recipient_id = 'claude-ai') OR (r.recipient_id = ?1 AND r.requester_id = 'claude-ai')))
          ORDER BY m.created_at ASC, m.rowid ASC`,
      )
      .bind(userId),
    db
      .prepare(
        `SELECT md.id, md.message_id, md.messages_json, md.created_at, m.conversation_id, m.content AS message_content
           FROM message_discussions md JOIN messages m ON m.id = md.message_id
          WHERE md.user_id = ?`,
      )
      .bind(userId),
  ]);
  const rows = <T>(r: D1Result<Record<string, unknown>>) => (r.results ?? []) as unknown as T[];
  const dead = new Set(rows<{ id: string }>(tombstones).map((r) => r.id));
  const statements: D1PreparedStatement[] = [];
  const touched = new Set<string>();

  // ---- note_questions → card threads ----
  const threadOf = new Map(rows<{ legacy_id: string; conversation_id: string }>(copied).map((r) => [r.legacy_id, r.conversation_id]));
  const qs = rows<QuestionRow>(questions).map((q) => ({ ...q, asked_at: sqliteToIso(q.asked_at || '') }));
  for (const group of groupQuestionThreads(qs)) {
    const missing = group.questions.filter((q) => !threadOf.has(q.id));
    if (missing.length === 0) continue;
    const already = group.questions.map((q) => threadOf.get(q.id)).find((id): id is string => !!id);
    const threadId = already ?? `nq-${group.id}`;
    if (dead.has(threadId)) continue;
    if (!already) {
      const first = group.questions[0];
      statements.push(insertThreadStatement(db, cardThread(userId, threadId, first)));
      counts.card_threads++;
    }
    for (const q of missing) {
      statements.push(...questionStatements(db, threadId, q));
      counts.card_messages += 2;
    }
    touched.add(threadId);
  }

  // ---- Claude practice chats → practice threads (read-only) ----
  const byConversation = new Map<string, PracticeMessageRow[]>();
  for (const m of rows<PracticeMessageRow>(practiceMessages)) {
    const list = byConversation.get(m.conversation_id) ?? [];
    list.push(m);
    byConversation.set(m.conversation_id, list);
  }
  for (const c of rows<PracticeRow>(practice)) {
    const threadId = `pc-${c.id}`;
    if (dead.has(threadId)) continue;
    const context: ClaudeThreadContext = {
      kind: 'practice',
      conversation_id: c.id,
      ...(c.scenario ? { scenario: c.scenario.slice(0, 200) } : {}),
      ...(c.ai_role ? { ai_role: c.ai_role.slice(0, 200) } : {}),
      ...(c.user_role ? { user_role: c.user_role.slice(0, 200) } : {}),
      ...(c.voice_id ? { voice_id: c.voice_id } : {}),
    };
    const snapshot: ClaudeContextSnapshot = { ...(c.scenario ? { label: c.scenario.slice(0, 80) } : {}), ...(c.ai_role ? { sublabel: c.ai_role.slice(0, 80) } : {}) };
    const messages = (byConversation.get(c.id) ?? []).filter((m) => (m.sender_id === 'claude-ai' || m.sender_id === userId) && (m.content || '').trim());
    statements.push(
      insertThreadStatement(db, {
        id: threadId,
        userId,
        context,
        snapshot,
        title: (c.title || '').trim() || titleFor({ ...context, ...snapshot }, ''),
        source: 'practice',
        legacyId: c.id,
        readOnly: true,
        createdAt: c.created_at,
      }),
    );
    counts.practice_threads++;
    for (const m of messages) {
      statements.push(
        insertMessageStatement(db, {
          id: `pc-${m.id}`,
          threadId,
          role: m.sender_id === 'claude-ai' ? 'assistant' : 'user',
          content: m.content,
          legacyId: m.id,
          createdAt: m.created_at,
        }),
      );
      counts.practice_messages++;
    }
    touched.add(threadId);
  }

  // ---- Discuss with Claude → chat_message threads ----
  for (const d of rows<DiscussionRow>(discussions)) {
    const made = discussionStatements(db, userId, d, dead);
    if (!made) continue;
    statements.push(...made.statements);
    counts.discussion_threads++;
    counts.discussion_messages += made.messages;
    touched.add(made.threadId);
  }

  for (const id of touched) statements.push(touchThreadStatement(db, id));
  for (let i = 0; i < statements.length; i += BACKFILL_BATCH) await db.batch(statements.slice(i, i + BACKFILL_BATCH));
  await db.prepare(`UPDATE users SET claude_threads_backfilled_at = ${NOW_ISO} WHERE id = ?`).bind(userId).run();
  return counts;
}

function cardThread(userId: string, threadId: string, first: QuestionRow) {
  const context: ClaudeThreadContext = { kind: 'card', note_id: first.note_id };
  const snapshot: ClaudeContextSnapshot = { label: first.hanzi.slice(0, 80), ...(first.deck_name ? { sublabel: first.deck_name.slice(0, 80) } : {}) };
  return {
    id: threadId,
    userId,
    context,
    snapshot,
    title: titleFor({ ...context, ...snapshot }, first.question),
    source: 'note_questions',
    legacyId: first.id,
    createdAt: first.asked_at,
  };
}

function questionStatements(db: D1Database, threadId: string, q: QuestionRow): D1PreparedStatement[] {
  const user: NewMessage & { id: string } = {
    id: `nq-${q.id}-q`,
    threadId,
    role: 'user',
    content: q.question,
    intent: 'ask',
    translation: q.question_translation,
    autoCheck: q.question_check,
    legacyId: q.id,
    createdAt: q.asked_at,
  };
  const reply: NewMessage & { id: string } = {
    id: `nq-${q.id}-a`,
    threadId,
    role: 'assistant',
    content: q.answer,
    answerLang: lang(q.answer_lang),
    translation: q.answer_translation,
    legacyId: q.id,
    createdAt: q.asked_at,
  };
  return [insertMessageStatement(db, user), insertMessageStatement(db, reply)];
}

function discussionStatements(
  db: D1Database,
  userId: string,
  d: DiscussionRow,
  dead: Set<string>,
): { threadId: string; statements: D1PreparedStatement[]; messages: number } | null {
  const threadId = `md-${d.id}`;
  if (dead.has(threadId)) return null;
  let list: Array<{ role?: unknown; content?: unknown }> = [];
  try {
    const parsed = JSON.parse(d.messages_json || '[]');
    if (Array.isArray(parsed)) list = parsed;
  } catch {
    return null;
  }
  const context: ClaudeThreadContext = { kind: 'chat_message', message_id: d.message_id, conversation_id: d.conversation_id };
  const label = previewOf(d.message_content || '').slice(0, 40);
  const snapshot: ClaudeContextSnapshot = label ? { label } : {};
  const firstQuestion = list.find((m) => m.role === 'user' && typeof m.content === 'string');
  const statements: D1PreparedStatement[] = [
    insertThreadStatement(db, {
      id: threadId,
      userId,
      context,
      snapshot,
      title: titleFor({ ...context, ...snapshot }, typeof firstQuestion?.content === 'string' ? firstQuestion.content : ''),
      source: 'discussion',
      legacyId: d.id,
      createdAt: d.created_at,
    }),
  ];
  let messages = 0;
  list.forEach((m, i) => {
    if ((m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim()) return;
    statements.push(
      insertMessageStatement(db, {
        id: `md-${d.id}-${i}`,
        threadId,
        role: m.role,
        content: m.content,
        ...(m.role === 'user' ? { intent: 'ask' as const } : {}),
        legacyId: `${d.id}:${i}`,
        createdAt: d.created_at,
      }),
    );
    messages++;
  });
  return { threadId, statements, messages };
}

// ---------- The dual-writes (older apps keep the old routes) ----------

/**
 * A Q&A just stored by `POST /api/notes/:id/ask` → the card's thread: the latest thread about the
 * note when its last message is ≤ 30 min old (the grouping rule), else a new `nq-<id>` thread.
 * Before the user's backfill has run, the backfill copies it (with everything before it).
 */
export async function appendCardQuestion(
  db: D1Database,
  userId: string,
  note: Pick<Note, 'id' | 'hanzi'>,
  q: { id: string; question: string; answer: string; asked_at?: string | null; answer_lang?: string | null; question_check?: string | null },
): Promise<string | null> {
  if (await ensureClaudeThreadsBackfilled(db, userId)) return null;
  const present = await db
    .prepare(
      `SELECT m.conversation_id FROM coach_messages m JOIN coach_conversations c ON c.id = m.conversation_id
        WHERE c.user_id = ? AND c.context_kind = 'card' AND m.role = 'user' AND m.legacy_id = ?`,
    )
    .bind(userId, q.id)
    .first<{ conversation_id: string }>();
  if (present) return present.conversation_id;
  const askedAt = sqliteToIso(q.asked_at || new Date().toISOString());
  const latest = await latestCardThread(db, userId, note.id);
  const lastAt = latest?.last_message_at ? Date.parse(latest.last_message_at) : NaN;
  const reuse = latest && Number.isFinite(lastAt) && Date.parse(askedAt) - lastAt <= THREAD_GAP_MS;
  const threadId = reuse ? latest!.id : `nq-${q.id}`;
  const row: QuestionRow = {
    id: q.id,
    note_id: note.id,
    question: q.question,
    answer: q.answer,
    asked_at: askedAt,
    answer_lang: q.answer_lang ?? null,
    answer_translation: null,
    question_translation: null,
    question_check: q.question_check ?? null,
    hanzi: note.hanzi,
    deck_name: null,
  };
  const statements: D1PreparedStatement[] = [];
  if (!reuse) statements.push(insertThreadStatement(db, cardThread(userId, threadId, row)));
  statements.push(...questionStatements(db, threadId, row), touchThreadStatement(db, threadId));
  await db.batch(statements);
  return threadId;
}

/**
 * Discuss with Claude saved its discussion (`PUT /api/messages/:id/discussion`, the app sends the
 * whole list) → the `md-<id>` thread gets the messages it doesn't have yet. Before the user's
 * backfill has run, the backfill copies it.
 */
export async function syncDiscussionThread(db: D1Database, userId: string, messageId: string): Promise<string | null> {
  if (await ensureClaudeThreadsBackfilled(db, userId)) return null;
  const d = await db
    .prepare(
      `SELECT md.id, md.message_id, md.messages_json, md.created_at, m.conversation_id, m.content AS message_content
         FROM message_discussions md JOIN messages m ON m.id = md.message_id
        WHERE md.user_id = ? AND md.message_id = ?`,
    )
    .bind(userId, messageId)
    .first<DiscussionRow>();
  if (!d) return null;
  const dead = await db.prepare('SELECT id FROM coach_conversations WHERE id = ? AND deleted_at IS NOT NULL').bind(`md-${d.id}`).first<{ id: string }>();
  // Messages added later are stamped now (they came after the ones copied before).
  const made = discussionStatements(db, userId, { ...d, created_at: null }, new Set(dead ? [dead.id] : []));
  if (!made) return null;
  await db.batch([...made.statements, touchThreadStatement(db, made.threadId)]);
  return made.threadId;
}
