/**
 * Ask-Claude questions on a card, read from the ONE store: the card threads (docs/CHAT.md "Claude
 * threads"). A question = a learner message in a `card` thread + the first finished reply after it.
 *
 * `note_questions` is FROZEN (Nov 2026): nothing writes it any more — every question since lives only in
 * its card thread, and the rows from before were copied in by the lazy backfill (`backfill.ts`, each
 * message keeps the row's id as `legacy_id`). The older row-shaped endpoints are served from here so
 * installed builds keep working:
 *   GET  /me/claude-chats, /relationships/:relId/claude-chats   → `listCardQuestions`
 *   GET  /notes/:noteId/hub (+ the tutor's)                      → its `questions`
 *   GET  /notes/:id/questions                                    → `noteQuestionRows`
 *   GET|POST /note-questions/:id[/words|/translate]              → `findCardQuestion`
 * A question's id is the copied row's id (`legacy_id`) when it has one, else its message id, so an id an
 * old app holds keeps resolving.
 */
import { sqliteToIso } from '@shared/chats/threads';
import type { ClaudeTutorVisibility } from '@shared/claude/visibility';
import { ensureClaudeThreadsBackfilled } from './backfill';
import { getTutorVisibility, tutorVisibleSql } from './tutor-view';

/** One Q&A on a card in the older `/claude-chats` row shape. */
export interface CardQuestion {
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

/** One Q&A with everything the old `note_questions` row carried (ask-claude.ts shapes it). */
export interface CardQuestionDetail {
  id: string;
  note_id: string;
  question: string;
  answer: string;
  asked_at: string;
  answer_lang: string | null;
  answer_translation: string | null;
  question_translation: string | null;
  question_check: string | null;
  /** The two thread messages (translations / the check are written onto them). */
  question_message_id: string;
  answer_message_id: string;
}

interface Row {
  id: string;
  legacy_id: string | null;
  question: string;
  asked_at: string;
  note_id: string;
  question_translation: string | null;
  question_check: string | null;
  answer_id: string | null;
  answer: string | null;
  answer_lang: string | null;
  answer_translation: string | null;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
}

/** The reply to the user message `u`: the first finished text reply after it in the same thread. */
const REPLY_JOIN = `LEFT JOIN coach_messages a ON a.id = (
    SELECT a2.id FROM coach_messages a2
     WHERE a2.conversation_id = u.conversation_id AND a2.role = 'assistant' AND a2.status IS NULL AND a2.content_type = 'text'
       AND (a2.created_at > u.created_at OR (a2.created_at = u.created_at AND a2.rowid > u.rowid))
     ORDER BY a2.created_at ASC, a2.rowid ASC LIMIT 1)`;

const SELECT = `SELECT u.id, u.legacy_id, u.content AS question, u.created_at AS asked_at, c.context_ref AS note_id,
       u.translation AS question_translation, u.auto_check AS question_check,
       a.id AS answer_id, a.content AS answer, a.answer_lang, a.translation AS answer_translation,
       n.hanzi, n.pinyin, n.english, d.id AS deck_id, d.name AS deck_name`;

const FROM = `FROM coach_messages u
  JOIN coach_conversations c ON c.id = u.conversation_id
  JOIN notes n ON n.id = c.context_ref
  JOIN decks d ON d.id = n.deck_id`;

/** The owner's card-thread questions (`?1` = the owner). */
const OWNED = ['c.user_id = ?1', 'd.user_id = ?1', 'c.deleted_at IS NULL', "c.context_kind = 'card'", "u.role = 'user'", "u.status IS NULL AND u.content != ''"];

const toQuestion = (r: Row): CardQuestion => ({
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
});

const toDetail = (r: Row): CardQuestionDetail => ({
  id: r.legacy_id || r.id,
  note_id: r.note_id,
  question: r.question,
  answer: r.answer ?? '',
  asked_at: sqliteToIso(r.asked_at),
  answer_lang: r.answer_lang,
  answer_translation: r.answer_translation,
  question_translation: r.question_translation,
  question_check: r.question_check,
  question_message_id: r.id,
  answer_message_id: r.answer_id ?? '',
});

async function backfilled(db: D1Database, userId: string): Promise<void> {
  await ensureClaudeThreadsBackfilled(db, userId).catch((err) => console.error('[card-questions] backfill failed', err instanceof Error ? err.message : err));
}

/**
 * The owner's questions newest first, keyset-paged on asked_at (`before` = a previous page's
 * `next_cursor`). With `visibility` (the tutor's view): only the threads the student lets her read.
 */
export async function listCardQuestions(
  db: D1Database,
  ownerId: string,
  opts: { limit?: number; before?: string | null; noteId?: string | null; visibility?: ClaudeTutorVisibility } = {},
): Promise<{ questions: CardQuestion[]; next_cursor: string | null; total: number }> {
  await backfilled(db, ownerId);
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? 100), 1), 500);
  const where = [...OWNED];
  if (opts.visibility) where.push(tutorVisibleSql(opts.visibility));
  const params: unknown[] = [ownerId];
  if (opts.noteId) {
    params.push(opts.noteId);
    where.push(`c.context_ref = ?${params.length}`);
  }
  const countSql = `SELECT COUNT(*) AS n ${FROM} WHERE ${where.join(' AND ')}`;
  const countParams = [...params];
  if (opts.before) {
    params.push(opts.before.replace('T', ' ').replace(/(\.\d+)?Z$/, ''));
    where.push(`u.created_at < ?${params.length}`);
  }
  params.push(limit + 1);
  const [rows, total] = await db.batch<Record<string, unknown>>([
    db.prepare(`${SELECT} ${FROM} ${REPLY_JOIN} WHERE ${where.join(' AND ')} ORDER BY u.created_at DESC, u.rowid DESC LIMIT ?${params.length}`).bind(...params),
    db.prepare(countSql).bind(...countParams),
  ]);
  const all = ((rows.results ?? []) as unknown as Row[]).map(toQuestion);
  const hasMore = all.length > limit;
  const page = hasMore ? all.slice(0, limit) : all;
  return {
    questions: page.filter((q) => q.answer),
    next_cursor: hasMore ? page[page.length - 1].asked_at : null,
    total: Number((total.results?.[0] as { n?: number } | undefined)?.n ?? page.length),
  };
}

/**
 * The tutor's `/claude-chats` and card hub `questions` for apps from before the thread view: only the
 * card threads the student lets her read (shared/claude/visibility.ts).
 */
export async function tutorCardQuestions(
  db: D1Database,
  studentId: string,
  opts: { limit?: number; before?: string | null; noteId?: string | null } = {},
): Promise<{ questions: CardQuestion[]; next_cursor: string | null; total: number }> {
  await backfilled(db, studentId);
  return listCardQuestions(db, studentId, { ...opts, visibility: await getTutorVisibility(db, studentId) });
}

/** Every answered question about one of the owner's notes, newest first (`GET /notes/:id/questions`). */
export async function noteQuestionRows(db: D1Database, ownerId: string, noteId: string): Promise<CardQuestionDetail[]> {
  await backfilled(db, ownerId);
  const res = await db
    .prepare(`${SELECT} ${FROM} ${REPLY_JOIN} WHERE ${OWNED.join(' AND ')} AND c.context_ref = ?2 ORDER BY u.created_at DESC, u.rowid DESC LIMIT 200`)
    .bind(ownerId, noteId)
    .all<Row>();
  return (res.results ?? []).filter((r) => r.answer_id).map(toDetail);
}

/** One of the owner's questions by the id an app holds (the copied row's id, or the message id); null = none. */
export async function findCardQuestion(db: D1Database, ownerId: string, id: string): Promise<CardQuestionDetail | null> {
  await backfilled(db, ownerId);
  const row = await db
    .prepare(`${SELECT} ${FROM} ${REPLY_JOIN} WHERE ${OWNED.join(' AND ')} AND (u.legacy_id = ?2 OR u.id = ?2) ORDER BY u.created_at ASC LIMIT 1`)
    .bind(ownerId, id)
    .first<Row>();
  return row && row.answer_id ? toDetail(row) : null;
}
