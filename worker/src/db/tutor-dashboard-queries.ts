/**
 * Database access for the tutor dashboard and the reorganised student page.
 * All SQL for the feature lives here; services/tutor-dashboard.ts turns the
 * rows into the card the tutor sees.
 */

import { isInReviewQueue, parseCharScores, type RecordingCheck } from '@shared/recordings/queue';
import type {
  ActivityRow,
  HomeworkDeckInput,
  HomeworkLessonInput,
  StudentUserRow,
  InviteRef,
} from '../services/tutor-dashboard';
import { listDeckQueue, type DeckQueueRow } from './queries';

// ---------- Student row ----------

export async function fetchStudentUserRow(db: D1Database, studentId: string): Promise<StudentUserRow | null> {
  return db
    .prepare(
      `SELECT u.id, u.email, u.name, u.picture_url, u.last_login_at, u.install_kind, u.cached_audio_count, u.last_opened_at, u.created_at,
              u.new_cards_per_day, u.secondary_cards_per_day, u.study_budget_set_by, u.study_budget_set_at,
              s.name AS study_budget_set_by_name
       FROM users u LEFT JOIN users s ON s.id = u.study_budget_set_by
       WHERE u.id = ?`
    )
    .bind(studentId)
    .first<StudentUserRow>();
}

// ---------- Review activity ----------

/** Lightweight rows for the last `days` days (streak, "studied today", activity days). */
export async function fetchActivityRows(db: D1Database, studentId: string, from: string, limit = 5000): Promise<ActivityRow[]> {
  const res = await db
    .prepare(
      `SELECT reviewed_at, rating, time_spent_ms FROM review_events
       WHERE user_id = ? AND reviewed_at >= ?
       ORDER BY reviewed_at DESC LIMIT ?`
    )
    .bind(studentId, from, limit)
    .all<ActivityRow>();
  return res.results || [];
}

export async function fetchReviewTotals(
  db: D1Database,
  studentId: string
): Promise<{ total: number; first_review_at: string | null }> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS total, MIN(reviewed_at) AS first_review_at FROM review_events WHERE user_id = ?`)
    .bind(studentId)
    .first<{ total: number; first_review_at: string | null }>();
  return { total: row?.total ?? 0, first_review_at: row?.first_review_at ?? null };
}

/** All-time recordings by the student that no tutor has marked yet. */
export async function countUnheardRecordings(db: D1Database, studentId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM review_events re
       LEFT JOIN tutor_recording_marks m ON m.review_event_id = re.id
       WHERE re.user_id = ? AND re.recording_url IS NOT NULL AND m.review_event_id IS NULL`
    )
    .bind(studentId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * "Needs your ear": unmarked recordings (all time, newest 500) that the shared queue rule
 * (shared/recordings/queue.ts) puts in front of the tutor — mismatched transcript, Again / Hard,
 * low score / a character that sounded off, or an open flag on the word.
 */
export async function countRecordingsNeedingEar(db: D1Database, studentId: string, relationshipId: string): Promise<number> {
  const [rows, flags] = await Promise.all([
    db
      .prepare(
        `SELECT re.rating, c.note_id, rc.status, rc.transcript, rc.transcript_match, rc.score, rc.char_scores
         FROM review_events re
         JOIN cards c ON c.id = re.card_id
         LEFT JOIN tutor_recording_marks m ON m.review_event_id = re.id
         LEFT JOIN recording_checks rc ON rc.review_event_id = re.id
         WHERE re.user_id = ? AND re.recording_url IS NOT NULL AND m.review_event_id IS NULL
         ORDER BY re.reviewed_at DESC LIMIT 500`
      )
      .bind(studentId)
      .all<{ rating: number; note_id: string; status: string | null; transcript: string | null; transcript_match: number | null; score: number | null; char_scores: string | null }>(),
    db.prepare(`SELECT note_id FROM card_flags WHERE relationship_id = ? AND status = 'open'`).bind(relationshipId).all<{ note_id: string }>(),
  ]);
  const flagged = new Set((flags.results ?? []).map((f) => f.note_id));
  let n = 0;
  for (const r of rows.results ?? []) {
    const check: RecordingCheck | null = r.status
      ? { status: 'done', transcript: r.transcript, transcript_match: r.transcript_match == null ? null : r.transcript_match === 1, score: r.score, char_scores: parseCharScores(r.char_scores) }
      : null;
    if (isInReviewQueue({ rating: r.rating, check, flagged: flagged.has(r.note_id), marked: false })) n++;
  }
  return n;
}

// ---------- Homework ----------

/** Decks the tutor shared in this relationship, with the state of the student's copy. */
export async function fetchHomeworkDecks(db: D1Database, relationshipId: string): Promise<HomeworkDeckInput[]> {
  const res = await db
    .prepare(
      `SELECT sd.id AS shared_deck_id, sd.source_deck_id, sd.target_deck_id, sd.shared_at,
              COALESCE(src.name, '(deleted)') AS source_deck_name,
              tgt.name AS target_deck_name,
              (SELECT COUNT(*) FROM cards c JOIN notes n ON n.id = c.note_id WHERE n.deck_id = sd.target_deck_id) AS cards_total,
              (SELECT COUNT(*) FROM cards c JOIN notes n ON n.id = c.note_id WHERE n.deck_id = sd.target_deck_id AND COALESCE(c.queue, 0) != 0) AS cards_started,
              (SELECT COUNT(*) FROM cards c JOIN notes n ON n.id = c.note_id WHERE n.deck_id = sd.target_deck_id AND COALESCE(c.stability, 0) > 21) AS cards_mastered,
              (SELECT COUNT(*) FROM notes n WHERE n.deck_id = sd.target_deck_id) AS notes_total,
              (SELECT COUNT(*) FROM notes n WHERE n.deck_id = sd.target_deck_id
                 AND EXISTS (SELECT 1 FROM cards c WHERE c.note_id = n.id AND COALESCE(c.queue, 0) != 0)) AS notes_introduced,
              (SELECT COUNT(*) FROM notes n WHERE n.deck_id = sd.target_deck_id AND n.long_term = 0
                 AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.note_id = n.id AND COALESCE(c.queue, 0) != 0)) AS notes_left_out,
              COALESCE(tgt.study_priority, 0) AS study_priority,
              (SELECT COUNT(*) FROM notes s WHERE s.deck_id = sd.source_deck_id
                 AND NOT EXISTS (SELECT 1 FROM notes t WHERE t.deck_id = sd.target_deck_id AND t.hanzi = s.hanzi)) AS notes_missing
       FROM shared_decks sd
       LEFT JOIN decks src ON src.id = sd.source_deck_id
       LEFT JOIN decks tgt ON tgt.id = sd.target_deck_id
       WHERE sd.relationship_id = ?
       ORDER BY sd.shared_at DESC`
    )
    .bind(relationshipId)
    .all<HomeworkDeckInput>();
  return dropGhostShares(res.results || []);
}

/**
 * A share whose tutor deck AND student copy are both deleted is history, not
 * homework — listing it kept a "(deleted)" packet on the student page. A copy
 * the student deleted (tutor deck still there) stays, contributing nothing to
 * progress; a copy whose tutor deck is gone stays too (the student still has it).
 */
export function dropGhostShares(rows: HomeworkDeckInput[]): HomeworkDeckInput[] {
  return rows
    .filter((d) => !(d.target_deck_name == null && d.source_deck_name === '(deleted)'))
    .map((d) => (d.target_deck_name == null ? { ...d, cards_total: 0, cards_started: 0, cards_mastered: 0, notes_total: 0, notes_introduced: 0, notes_left_out: 0 } : d));
}

/** The student's whole deck queue (first = studied first), for queue positions on the homework rows. */
export async function fetchStudentDeckQueue(db: D1Database, studentId: string): Promise<DeckQueueRow[]> {
  return listDeckQueue(db, studentId);
}

export interface SharedDeckRef {
  id: string;
  relationship_id: string;
  source_deck_id: string;
  target_deck_id: string;
}

/** One shared_decks row, only if it belongs to the relationship. */
export async function fetchSharedDeck(db: D1Database, sharedDeckId: string, relationshipId: string): Promise<SharedDeckRef | null> {
  const row = await db
    .prepare('SELECT id, relationship_id, source_deck_id, target_deck_id FROM shared_decks WHERE id = ? AND relationship_id = ?')
    .bind(sharedDeckId, relationshipId)
    .first<SharedDeckRef>();
  return row ?? null;
}

/** Lessons the tutor assigned to the student in this relationship, with completion counts. */
export async function fetchHomeworkLessons(
  db: D1Database,
  relationshipId: string,
  tutorId: string,
  studentId: string
): Promise<HomeworkLessonInput[]> {
  const res = await db
    .prepare(
      `SELECT cl.id AS lesson_id, cl.title, cl.icon, cl.created_at,
              (SELECT COUNT(*) FROM custom_lesson_completions x WHERE x.lesson_id = cl.id) AS completions,
              (SELECT MAX(completed_at) FROM custom_lesson_completions x WHERE x.lesson_id = cl.id) AS last_completed_at,
              (SELECT rating FROM custom_lesson_completions x WHERE x.lesson_id = cl.id ORDER BY completed_at DESC LIMIT 1) AS last_rating
       FROM custom_lessons cl
       WHERE cl.user_id = ? AND cl.assigned_by = ? AND (cl.assigned_relationship_id = ? OR cl.assigned_relationship_id IS NULL)
       ORDER BY cl.created_at DESC`
    )
    .bind(studentId, tutorId, relationshipId)
    .all<HomeworkLessonInput>();
  return res.results || [];
}

/** Notes with audio in the student's own decks — what a full prefetch would cache. */
export async function countStudentAudioClips(db: D1Database, studentId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM notes n JOIN decks d ON d.id = n.deck_id
       WHERE d.user_id = ? AND n.audio_url IS NOT NULL AND n.audio_url != ''`
    )
    .bind(studentId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// ---------- Invite that created the student ----------

/** The tutor's invite this student redeemed (newest), for "Show QR again". */
export async function fetchRedeemedInvite(
  db: D1Database,
  tutorId: string,
  studentId: string,
  frontendUrl: string
): Promise<InviteRef | null> {
  const row = await db
    .prepare(
      `SELECT i.id, i.revoked_at, i.expires_at, i.max_uses, i.use_count, r.redeemed_at
       FROM invite_redemptions r JOIN invites i ON i.id = r.invite_id
       WHERE i.created_by = ? AND r.user_id = ?
       ORDER BY r.redeemed_at DESC LIMIT 1`
    )
    .bind(tutorId, studentId)
    .first<{ id: string; revoked_at: string | null; expires_at: string | null; max_uses: number; use_count: number; redeemed_at: string }>();
  if (!row) return null;
  const status = row.revoked_at
    ? 'revoked'
    : row.expires_at && new Date(row.expires_at).getTime() < Date.now()
      ? 'expired'
      : row.use_count >= row.max_uses
        ? 'used'
        : 'active';
  return { id: row.id, url: `${frontendUrl}/join/${row.id}`, status, redeemed_at: row.redeemed_at };
}

// ---------- Conversations ----------

/** THE conversation of the pair (one chat per pair, migration 0102), or null when none yet. */
export async function fetchLastConversationId(db: D1Database, relationshipId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT id FROM conversations WHERE relationship_id = ? AND merged_into IS NULL
       ORDER BY COALESCE(is_ai_conversation, 0) ASC, COALESCE(last_message_at, created_at) DESC LIMIT 1`
    )
    .bind(relationshipId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

// ---------- Tutor's homework decks (dashboard footer) ----------

export interface HomeworkDeckSummaryRow {
  deck_id: string;
  name: string;
  note_count: number;
  student_count: number;
  last_shared_at: string;
}

/** Decks the tutor has shared with anyone, with how many students received them. */
export async function fetchTutorHomeworkDecks(db: D1Database, tutorId: string): Promise<HomeworkDeckSummaryRow[]> {
  const res = await db
    .prepare(
      `SELECT d.id AS deck_id, d.name,
              (SELECT COUNT(*) FROM notes n WHERE n.deck_id = d.id) AS note_count,
              COUNT(DISTINCT sd.relationship_id) AS student_count,
              MAX(sd.shared_at) AS last_shared_at
       FROM shared_decks sd JOIN decks d ON d.id = sd.source_deck_id
       JOIN tutor_relationships tr ON tr.id = sd.relationship_id AND tr.status = 'active'
       WHERE d.user_id = ?
       GROUP BY d.id ORDER BY last_shared_at DESC`
    )
    .bind(tutorId)
    .all<HomeworkDeckSummaryRow>();
  return res.results || [];
}

// ---------- Client state report (migration 0064) ----------

export async function recordClientState(
  db: D1Database,
  userId: string,
  state: { install_kind: 'pwa' | 'android' | 'browser' | null; cached_audio_count: number | null }
): Promise<void> {
  // Once a device has reported an install, a later browser-tab visit (a laptop,
  // say) must not downgrade it — the question is "did they install", not
  // "what did they use last".
  await db
    .prepare(
      `UPDATE users SET
         install_kind = CASE WHEN install_kind IN ('pwa', 'android') AND ? = 'browser' THEN install_kind ELSE COALESCE(?, install_kind) END,
         cached_audio_count = COALESCE(?, cached_audio_count),
         last_opened_at = datetime('now')
       WHERE id = ?`
    )
    .bind(state.install_kind, state.install_kind, state.cached_audio_count, userId)
    .run();
}
