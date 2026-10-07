/**
 * Delete a whole account — the ONE path that removes a user (admin only).
 *
 * What goes: the user's decks / notes / cards / review events (+ recordings),
 * sentence sets, readers, lessons + library, quests, coach chats, feature
 * requests, sessions (web + MCP OAuth), invites, every tutor relationship with
 * its conversations / messages / shares / lesson log / summaries / flags /
 * session-notes jobs / calls, and the R2 objects only they used.
 *
 * What stays: anything that now lives in ANOTHER account. A tutor's deck and
 * reader COPIES in students' accounts are the students' own rows and are not
 * touched; lessons the tutor assigned stay with the student (unlinked from the
 * deleted library item); R2 clips / images those copies share with the
 * deleted originals are kept (only keys nothing else references are removed).
 *
 * Order: all DB deletes run child-first in ONE `db.batch` (a D1 transaction —
 * all or nothing), so the result is correct whether or not SQLite foreign-key
 * cascades are on. R2 clean-up runs after the commit. No tombstones are
 * written: no other account's device holds the deleted rows, and the deleted
 * user's own devices lose their sessions.
 *
 * Refuses: the caller's own account, any admin, ADMIN_EMAIL and the built-in
 * Claude AI user. The caller must type the account's email to confirm.
 */
import type { Env } from '../../types';

export const PROTECTED_USER_IDS = ['claude-ai', 'default'] as const;

export interface DeletionGuardInput {
  actorId: string;
  adminEmail?: string | null;
}

export interface AccountSummary {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  is_admin: number;
}

export interface DeletionPreview {
  user: AccountSummary;
  /** Why the account cannot be deleted (empty = it can). */
  blockers: string[];
  /** Rows that will be deleted, by kind. */
  will_delete: Record<string, number>;
  /** Other accounts' rows that stay (copies the user once sent them). */
  will_keep: Record<string, number>;
  /** R2 objects the user alone references (removed after the DB delete). */
  r2_objects: number;
}

export interface DeletionResult {
  deleted_user: AccountSummary;
  deleted: Record<string, number>;
  kept: Record<string, number>;
  r2_objects_deleted: number;
}

export class AccountDeletionError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409) {
    super(message);
    this.name = 'AccountDeletionError';
  }
}

// ---------- Subqueries (?1 = the user's id throughout) ----------

const REL = `(SELECT id FROM tutor_relationships WHERE requester_id = ?1 OR recipient_id = ?1)`;
const DECKS = `(SELECT id FROM decks WHERE user_id = ?1)`;
const NOTES = `(SELECT id FROM notes WHERE deck_id IN ${DECKS})`;
const CARDS = `(SELECT id FROM cards WHERE note_id IN ${NOTES})`;
const READERS = `(SELECT id FROM graded_readers WHERE user_id = ?1)`;
const CALLS = `(SELECT id FROM calls WHERE created_by = ?1 OR relationship_id IN ${REL})`;
const PIECES = `(SELECT id FROM call_recording_pieces WHERE call_id IN ${CALLS} OR user_id = ?1)`;
const HOMEWORK = `(SELECT id FROM homework_assignments WHERE tutor_id = ?1 OR student_id = ?1 OR reader_id IN ${READERS})`;
const CONVERSATIONS = `(SELECT id FROM conversations WHERE relationship_id IN ${REL})`;
const MESSAGES = `(SELECT id FROM messages WHERE conversation_id IN ${CONVERSATIONS} OR sender_id = ?1)`;
const LESSONS = `(SELECT id FROM custom_lessons WHERE user_id = ?1)`;
const LIBRARY = `(SELECT id FROM lesson_library WHERE owner_id = ?1)`;
const EVENTS = `(SELECT id FROM review_events WHERE user_id = ?1 OR card_id IN ${CARDS})`;

/**
 * Every DB write, child-first. Each entry: a label for the counts and the SQL.
 * UPDATEs first: they detach other accounts' rows from things about to go.
 */
export const DELETE_STEPS: Array<{ label: string; sql: string }> = [
  // Other accounts' rows that point at the user: keep the row, drop the link.
  { label: 'assigned_lessons_unlinked', sql: `UPDATE custom_lessons SET assigned_by = NULL, assigned_relationship_id = NULL, library_item_id = NULL WHERE user_id != ?1 AND (assigned_by = ?1 OR library_item_id IN ${LIBRARY} OR assigned_relationship_id IN ${REL})` },
  { label: 'study_bumps_unlinked', sql: `UPDATE study_bumps SET bumped_by = NULL WHERE bumped_by = ?1 AND user_id != ?1` },
  { label: 'note_recordings_unlinked', sql: `UPDATE note_audio_recordings SET created_by = NULL WHERE created_by = ?1 AND note_id NOT IN ${NOTES}` },

  // Lesson materials (migration 0090): the user's own, and shares / notes in their relationships and calls.
  { label: 'material_pages', sql: `DELETE FROM material_pages WHERE material_id IN (SELECT id FROM materials WHERE owner_id = ?1)` },
  { label: 'material_shares', sql: `DELETE FROM material_shares WHERE shared_by = ?1 OR relationship_id IN ${REL} OR material_id IN (SELECT id FROM materials WHERE owner_id = ?1)` },
  { label: 'material_annotations', sql: `DELETE FROM material_annotations WHERE material_id IN (SELECT id FROM materials WHERE owner_id = ?1) OR lesson_id IN (SELECT lesson_id FROM calls WHERE id IN ${CALLS})` },
  { label: 'call_materials', sql: `DELETE FROM call_materials WHERE call_id IN ${CALLS} OR material_id IN (SELECT id FROM materials WHERE owner_id = ?1)` },
  { label: 'materials', sql: `DELETE FROM materials WHERE owner_id = ?1` },
  // In-call activities (migration 0094): results of the user's calls, and any they hosted.
  { label: 'call_activities', sql: `DELETE FROM call_activities WHERE call_id IN ${CALLS} OR started_by = ?1` },

  // Video calls (no foreign keys): segments → chunks → pieces → calls.
  { label: 'call_transcript_segments', sql: `DELETE FROM call_transcript_segments WHERE call_id IN ${CALLS} OR user_id = ?1` },
  { label: 'call_recording_chunks', sql: `DELETE FROM call_recording_chunks WHERE piece_id IN ${PIECES}` },
  { label: 'call_recording_pieces', sql: `DELETE FROM call_recording_pieces WHERE call_id IN ${CALLS} OR user_id = ?1` },
  // Board pages (the relationship's, and a solo call's own) and the call ↔ page links.
  { label: 'call_board_pages', sql: `DELETE FROM call_board_pages WHERE call_id IN ${CALLS} OR page_id IN (SELECT id FROM board_pages WHERE owner_id = ?1 OR relationship_id IN ${REL})` },
  { label: 'board_pages', sql: `DELETE FROM board_pages WHERE owner_id = ?1 OR relationship_id IN ${REL}` },
  { label: 'calls', sql: `DELETE FROM calls WHERE id IN ${CALLS}` },

  // Relationship-scoped rows without foreign keys.
  { label: 'card_flags', sql: `DELETE FROM card_flags WHERE student_id = ?1 OR tutor_id = ?1 OR relationship_id IN ${REL}` },
  { label: 'deck_check_jobs', sql: `DELETE FROM deck_check_jobs WHERE user_id = ?1 OR deck_owner_id = ?1 OR relationship_id IN ${REL}` },
  { label: 'tutor_note_jobs', sql: `DELETE FROM tutor_note_jobs WHERE tutor_id = ?1 OR student_id = ?1 OR relationship_id IN ${REL}` },
  { label: 'notifications', sql: `DELETE FROM notifications WHERE user_id = ?1 OR relationship_id IN ${REL} OR homework_id IN ${HOMEWORK}` },

  // Legacy reader homework.
  { label: 'homework_feedback', sql: `DELETE FROM homework_feedback WHERE tutor_id = ?1 OR homework_id IN ${HOMEWORK}` },
  { label: 'homework_recordings', sql: `DELETE FROM homework_recordings WHERE homework_id IN ${HOMEWORK}` },
  { label: 'homework_assignments', sql: `DELETE FROM homework_assignments WHERE id IN ${HOMEWORK}` },
  { label: 'tutor_review_requests', sql: `DELETE FROM tutor_review_requests WHERE student_id = ?1 OR tutor_id = ?1 OR relationship_id IN ${REL} OR note_id IN ${NOTES}` },

  // Study history.
  { label: 'card_reviews', sql: `DELETE FROM card_reviews WHERE session_id IN (SELECT id FROM study_sessions WHERE user_id = ?1) OR card_id IN ${CARDS}` },
  { label: 'study_sessions', sql: `DELETE FROM study_sessions WHERE user_id = ?1` },
  { label: 'tutor_recording_marks', sql: `DELETE FROM tutor_recording_marks WHERE tutor_id = ?1 OR review_event_id IN ${EVENTS}` },
  { label: 'recording_checks', sql: `DELETE FROM recording_checks WHERE user_id = ?1 OR review_event_id IN ${EVENTS}` },
  { label: 'review_events', sql: `DELETE FROM review_events WHERE id IN ${EVENTS}` },
  { label: 'daily_activities', sql: `DELETE FROM daily_activities WHERE user_id = ?1` },
  { label: 'daily_counts', sql: `DELETE FROM daily_counts WHERE user_id = ?1` },
  { label: 'study_time_days', sql: `DELETE FROM study_time_days WHERE user_id = ?1` },
  { label: 'usage_events', sql: `DELETE FROM usage_events WHERE user_id = ?1` },
  { label: 'daily_readers', sql: `DELETE FROM daily_readers WHERE user_id = ?1 OR reader_id IN ${READERS}` },
  { label: 'sync_metadata', sql: `DELETE FROM sync_metadata WHERE user_id = ?1` },
  { label: 'deleted_items', sql: `DELETE FROM deleted_items WHERE user_id = ?1` },

  // Decks → notes → cards and everything hanging off them.
  { label: 'card_checkpoints', sql: `DELETE FROM card_checkpoints WHERE card_id IN ${CARDS}` },
  { label: 'note_sentences', sql: `DELETE FROM note_sentences WHERE note_id IN ${NOTES}` },
  { label: 'note_sentence_jobs', sql: `DELETE FROM note_sentence_jobs WHERE note_id IN ${NOTES}` },
  { label: 'note_questions', sql: `DELETE FROM note_questions WHERE note_id IN ${NOTES}` },
  { label: 'note_audio_recordings', sql: `DELETE FROM note_audio_recordings WHERE note_id IN ${NOTES}` },
  { label: 'cards', sql: `DELETE FROM cards WHERE id IN ${CARDS}` },
  { label: 'notes', sql: `DELETE FROM notes WHERE id IN ${NOTES}` },
  { label: 'student_shared_decks', sql: `DELETE FROM student_shared_decks WHERE deck_id IN ${DECKS} OR relationship_id IN ${REL}` },
  { label: 'audio_lessons', sql: `DELETE FROM audio_lessons WHERE user_id = ?1` },
  { label: 'podcast_feeds', sql: `DELETE FROM podcast_feeds WHERE user_id = ?1` },
  { label: 'decks', sql: `DELETE FROM decks WHERE user_id = ?1` },

  // Readers.
  { label: 'reader_review_events', sql: `DELETE FROM reader_review_events WHERE user_id = ?1 OR reader_id IN ${READERS}` },
  { label: 'reader_pages', sql: `DELETE FROM reader_pages WHERE reader_id IN ${READERS}` },
  { label: 'shared_readers', sql: `DELETE FROM shared_readers WHERE relationship_id IN ${REL} OR source_reader_id IN ${READERS} OR target_reader_id IN ${READERS}` },
  { label: 'graded_readers', sql: `DELETE FROM graded_readers WHERE user_id = ?1` },

  // Lessons, library, editor chats.
  { label: 'custom_lesson_completions', sql: `DELETE FROM custom_lesson_completions WHERE user_id = ?1 OR lesson_id IN ${LESSONS}` },
  { label: 'custom_lessons', sql: `DELETE FROM custom_lessons WHERE user_id = ?1` },
  { label: 'lesson_library', sql: `DELETE FROM lesson_library WHERE owner_id = ?1` },
  { label: 'homework_links', sql: `DELETE FROM homework_links WHERE user_id = ?1` },
  { label: 'editor_chat_messages', sql: `DELETE FROM editor_chat_messages WHERE chat_id IN (SELECT id FROM editor_chats WHERE owner_id = ?1)` },
  { label: 'editor_chats', sql: `DELETE FROM editor_chats WHERE owner_id = ?1` },

  // Everything else the user owns.
  { label: 'folders', sql: `DELETE FROM folders WHERE user_id = ?1` },
  { label: 'study_bumps', sql: `DELETE FROM study_bumps WHERE user_id = ?1 OR note_id IN ${NOTES}` },
  { label: 'revisit_events', sql: `DELETE FROM revisit_events WHERE user_id = ?1` },
  { label: 'lesson_note_files', sql: `DELETE FROM lesson_note_files WHERE lesson_note_id IN (SELECT id FROM lesson_notes WHERE user_id = ?1)` },
  { label: 'lesson_notes', sql: `DELETE FROM lesson_notes WHERE user_id = ?1` },
  { label: 'quests', sql: `DELETE FROM quests WHERE user_id = ?1` },
  { label: 'picture_hunt_plays', sql: `DELETE FROM picture_hunt_plays WHERE user_id = ?1 OR hunt_id IN (SELECT id FROM picture_hunts WHERE user_id = ?1)` },
  { label: 'picture_hunts', sql: `DELETE FROM picture_hunts WHERE user_id = ?1` },
  { label: 'coach_messages', sql: `DELETE FROM coach_messages WHERE conversation_id IN (SELECT id FROM coach_conversations WHERE user_id = ?1)` },
  { label: 'coach_conversations', sql: `DELETE FROM coach_conversations WHERE user_id = ?1` },
  { label: 'roleplay_messages', sql: `DELETE FROM roleplay_messages WHERE session_id IN (SELECT id FROM roleplay_sessions WHERE user_id = ?1)` },
  { label: 'roleplay_sessions', sql: `DELETE FROM roleplay_sessions WHERE user_id = ?1` },
  { label: 'practice_attempts', sql: `DELETE FROM practice_attempts WHERE user_id = ?1 OR session_id IN (SELECT id FROM practice_sessions WHERE user_id = ?1)` },
  { label: 'practice_sessions', sql: `DELETE FROM practice_sessions WHERE user_id = ?1` },
  { label: 'pregenerated_practice_sessions', sql: `DELETE FROM pregenerated_practice_sessions WHERE user_id = ?1` },
  { label: 'grammar_progress', sql: `DELETE FROM grammar_progress WHERE user_id = ?1` },
  { label: 'feature_request_comments', sql: `DELETE FROM feature_request_comments WHERE request_id IN (SELECT id FROM feature_requests WHERE user_id = ?1)` },
  { label: 'feature_requests', sql: `DELETE FROM feature_requests WHERE user_id = ?1` },

  // Relationships and what lives in them.
  { label: 'message_reactions', sql: `DELETE FROM message_reactions WHERE user_id = ?1 OR message_id IN ${MESSAGES}` },
  { label: 'message_discussions', sql: `DELETE FROM message_discussions WHERE user_id = ?1 OR message_id IN ${MESSAGES}` },
  { label: 'conversation_reads', sql: `DELETE FROM conversation_reads WHERE user_id = ?1 OR conversation_id IN ${CONVERSATIONS}` },
  { label: 'chat_listening', sql: `DELETE FROM chat_listening WHERE user_id = ?1 OR conversation_id IN ${CONVERSATIONS}` },
  { label: 'messages', sql: `DELETE FROM messages WHERE id IN ${MESSAGES}` },
  { label: 'conversations', sql: `DELETE FROM conversations WHERE id IN ${CONVERSATIONS}` },
  { label: 'shared_decks', sql: `DELETE FROM shared_decks WHERE relationship_id IN ${REL}` },
  { label: 'student_summaries', sql: `DELETE FROM student_summaries WHERE relationship_id IN ${REL}` },
  { label: 'tutor_lesson_log', sql: `DELETE FROM tutor_lesson_log WHERE tutor_id = ?1 OR student_id = ?1 OR relationship_id IN ${REL}` },
  { label: 'student_profiles', sql: `DELETE FROM student_profiles WHERE tutor_id = ?1 OR student_id = ?1 OR relationship_id IN ${REL}` },
  { label: 'tutor_relationships', sql: `DELETE FROM tutor_relationships WHERE requester_id = ?1 OR recipient_id = ?1` },

  // Sign-in, invites.
  { label: 'invite_redemptions', sql: `DELETE FROM invite_redemptions WHERE user_id = ?1 OR invite_id IN (SELECT id FROM invites WHERE created_by = ?1)` },
  { label: 'invites', sql: `DELETE FROM invites WHERE created_by = ?1` },
  { label: 'pending_invitations', sql: `DELETE FROM pending_invitations WHERE inviter_id = ?1` },
  { label: 'push_subscriptions', sql: `DELETE FROM push_subscriptions WHERE user_id = ?1` },
  { label: 'device_push_tokens', sql: `DELETE FROM device_push_tokens WHERE user_id = ?1` },
  { label: 'oauth_codes', sql: `DELETE FROM oauth_codes WHERE user_id = ?1` },
  { label: 'oauth_tokens', sql: `DELETE FROM oauth_tokens WHERE user_id = ?1` },
  { label: 'auth_sessions', sql: `DELETE FROM auth_sessions WHERE user_id = ?1` },
  { label: 'access_requests', sql: `DELETE FROM access_requests WHERE email = (SELECT email FROM users WHERE id = ?1)` },
  { label: 'users', sql: `DELETE FROM users WHERE id = ?1` },
];

/** What the admin sees before confirming: counts of the rows that go and the copies that stay. */
const PREVIEW_COUNTS: Array<{ key: string; sql: string }> = [
  { key: 'decks', sql: `SELECT COUNT(*) AS n FROM decks WHERE user_id = ?1` },
  { key: 'notes', sql: `SELECT COUNT(*) AS n FROM notes WHERE deck_id IN ${DECKS}` },
  { key: 'cards', sql: `SELECT COUNT(*) AS n FROM cards WHERE note_id IN ${NOTES}` },
  { key: 'review_events', sql: `SELECT COUNT(*) AS n FROM review_events WHERE user_id = ?1` },
  { key: 'recordings', sql: `SELECT COUNT(*) AS n FROM review_events WHERE user_id = ?1 AND recording_url IS NOT NULL` },
  { key: 'readers', sql: `SELECT COUNT(*) AS n FROM graded_readers WHERE user_id = ?1` },
  { key: 'custom_lessons', sql: `SELECT COUNT(*) AS n FROM custom_lessons WHERE user_id = ?1` },
  { key: 'library_lessons', sql: `SELECT COUNT(*) AS n FROM lesson_library WHERE owner_id = ?1` },
  { key: 'relationships', sql: `SELECT COUNT(*) AS n FROM tutor_relationships WHERE requester_id = ?1 OR recipient_id = ?1` },
  { key: 'conversations', sql: `SELECT COUNT(*) AS n FROM conversations WHERE relationship_id IN ${REL}` },
  { key: 'messages', sql: `SELECT COUNT(*) AS n FROM messages WHERE id IN ${MESSAGES}` },
  { key: 'calls', sql: `SELECT COUNT(*) AS n FROM calls WHERE id IN ${CALLS}` },
  { key: 'coach_conversations', sql: `SELECT COUNT(*) AS n FROM coach_conversations WHERE user_id = ?1` },
  { key: 'quests', sql: `SELECT COUNT(*) AS n FROM quests WHERE user_id = ?1` },
  { key: 'picture_hunts', sql: `SELECT COUNT(*) AS n FROM picture_hunts WHERE user_id = ?1` },
  { key: 'feature_requests', sql: `SELECT COUNT(*) AS n FROM feature_requests WHERE user_id = ?1` },
  { key: 'invites', sql: `SELECT COUNT(*) AS n FROM invites WHERE created_by = ?1` },
  { key: 'sessions', sql: `SELECT (SELECT COUNT(*) FROM auth_sessions WHERE user_id = ?1) + (SELECT COUNT(*) FROM oauth_tokens WHERE user_id = ?1) AS n` },
];

const KEEP_COUNTS: Array<{ key: string; sql: string }> = [
  // The user's decks copied into other accounts (their tutor → student copies).
  { key: 'deck_copies_in_other_accounts', sql: `SELECT COUNT(*) AS n FROM shared_decks sd JOIN decks t ON t.id = sd.target_deck_id WHERE sd.source_deck_id IN ${DECKS} AND t.user_id != ?1` },
  { key: 'reader_copies_in_other_accounts', sql: `SELECT COUNT(*) AS n FROM shared_readers sr JOIN graded_readers t ON t.id = sr.target_reader_id WHERE sr.source_reader_id IN ${READERS} AND t.user_id != ?1` },
  { key: 'lessons_assigned_to_others', sql: `SELECT COUNT(*) AS n FROM custom_lessons WHERE user_id != ?1 AND assigned_by = ?1` },
];

// ---------- Guard ----------

export async function getAccountSummary(db: D1Database, userId: string): Promise<AccountSummary | null> {
  return db
    .prepare('SELECT id, email, name, role, is_admin FROM users WHERE id = ?')
    .bind(userId)
    .first<AccountSummary>();
}

export function deletionBlockers(user: AccountSummary, guard: DeletionGuardInput): string[] {
  const blockers: string[] = [];
  if (user.id === guard.actorId) blockers.push('You cannot delete your own account.');
  if (user.is_admin) blockers.push('Admin accounts cannot be deleted here — remove admin first.');
  if (guard.adminEmail && user.email && user.email.toLowerCase() === guard.adminEmail.toLowerCase()) {
    blockers.push('ADMIN_EMAIL is permanently invited and cannot be deleted.');
  }
  if ((PROTECTED_USER_IDS as readonly string[]).includes(user.id)) blockers.push('Built-in system account.');
  return blockers;
}

// ---------- R2 ----------

/** Keys only the deleted rows reference, split into "maybe shared" (checked) and "user-unique". */
async function collectR2Keys(db: D1Database, userId: string): Promise<string[]> {
  // D1 caps compound SELECTs (UNION) at a handful of terms: one plain SELECT per query.
  const col = async (sql: string, ...extra: unknown[]): Promise<string[]> => {
    const res = await db.prepare(sql).bind(userId, ...extra).all<{ k: string | null }>();
    return (res.results || []).map((r) => r.k).filter((k): k is string => !!k);
  };
  const cols = async (sqls: string[]): Promise<string[]> => (await Promise.all(sqls.map((q) => col(q)))).flat();

  // Clips of the user's notes. Deck copies in other accounts (either direction)
  // share the same keys, so any key another account's row still uses stays.
  const MINE_NOTE_KEYS = [
    `SELECT audio_url FROM notes WHERE deck_id IN ${DECKS}`,
    `SELECT sentence_clue_audio_url FROM notes WHERE deck_id IN ${DECKS}`,
    `SELECT audio_url FROM note_sentences WHERE note_id IN ${NOTES}`,
    `SELECT audio_url FROM note_audio_recordings WHERE note_id IN ${NOTES}`,
  ];
  const OTHER_NOTE_KEYS = [
    { col: 'audio_url', from: `notes WHERE deck_id NOT IN ${DECKS}` },
    { col: 'sentence_clue_audio_url', from: `notes WHERE deck_id NOT IN ${DECKS}` },
    { col: 'audio_url', from: `note_sentences WHERE note_id NOT IN ${NOTES}` },
    { col: 'audio_url', from: `note_audio_recordings WHERE note_id NOT IN ${NOTES}` },
  ];
  const noteKeys = await cols(MINE_NOTE_KEYS.map((q) => q.replace(/^SELECT (\w+)/, 'SELECT $1 AS k')));
  const sharedNoteKeys = new Set(await cols(
    OTHER_NOTE_KEYS.flatMap((o) => MINE_NOTE_KEYS.map((mine) => `SELECT ${o.col} AS k FROM ${o.from} AND ${o.col} IN (${mine})`))
  ));

  // Reader illustrations are shared with reader copies.
  const imageKeys = await col(`SELECT image_url AS k FROM reader_pages WHERE reader_id IN ${READERS}`);
  const sharedImageKeys = new Set(await col(
    `SELECT image_url AS k FROM reader_pages WHERE reader_id NOT IN ${READERS} AND image_url IN (SELECT image_url FROM reader_pages WHERE reader_id IN ${READERS})`
  ));

  // Lesson illustrations live inside the spec JSON; copies share them.
  const specs = await cols([
    `SELECT spec AS k FROM custom_lessons WHERE user_id = ?1`,
    `SELECT spec AS k FROM lesson_library WHERE owner_id = ?1`,
  ]);
  const lessonImageKeys = new Set<string>();
  for (const spec of specs) {
    for (const m of spec.matchAll(/"image_url"\s*:\s*"([^"]+)"/g)) lessonImageKeys.add(m[1]);
  }
  const sharedLessonKeys = new Set<string>();
  for (const key of lessonImageKeys) {
    const inLessons = await db.prepare('SELECT 1 AS k FROM custom_lessons WHERE user_id != ?1 AND instr(spec, ?2) > 0 LIMIT 1').bind(userId, key).first();
    const inLibrary = inLessons ? null : await db.prepare('SELECT 1 AS k FROM lesson_library WHERE owner_id != ?1 AND instr(spec, ?2) > 0 LIMIT 1').bind(userId, key).first();
    if (inLessons || inLibrary) sharedLessonKeys.add(key);
  }

  // Only ever the user's own.
  const unique = await cols([
    `SELECT recording_url AS k FROM review_events WHERE user_id = ?1`,
    `SELECT recording_url AS k FROM messages WHERE id IN ${MESSAGES}`,
    // Chat photos / voice messages of every message that goes (the key lives in the attachment JSON).
    `SELECT json_extract(attachment, '$.key') AS k FROM messages WHERE id IN ${MESSAGES} AND attachment IS NOT NULL`,
    `SELECT audio_key AS k FROM call_recording_pieces WHERE id IN ${PIECES}`,
    `SELECT r2_key AS k FROM call_recording_chunks WHERE piece_id IN ${PIECES}`,
    `SELECT r2_key AS k FROM lesson_note_files WHERE lesson_note_id IN (SELECT id FROM lesson_notes WHERE user_id = ?1)`,
    `SELECT audio_key AS k FROM audio_lessons WHERE user_id = ?1`,
    `SELECT image_url AS k FROM roleplay_messages WHERE session_id IN (SELECT id FROM roleplay_sessions WHERE user_id = ?1)`,
    `SELECT audio_url AS k FROM homework_recordings WHERE homework_id IN ${HOMEWORK}`,
    `SELECT audio_feedback_url AS k FROM homework_feedback WHERE tutor_id = ?1 OR homework_id IN ${HOMEWORK}`,
    `SELECT replace(screenshot_url, '/api/feature-requests/screenshot/', '') AS k FROM feature_requests WHERE user_id = ?1`,
    `SELECT picture_key AS k FROM users WHERE id = ?1`,
    `SELECT image_key AS k FROM picture_hunts WHERE user_id = ?1`,
    `SELECT original_key AS k FROM materials WHERE owner_id = ?1`,
    `SELECT image_key AS k FROM material_pages WHERE material_id IN (SELECT id FROM materials WHERE owner_id = ?1)`,
  ]);

  const keys = new Set<string>(unique);
  for (const k of noteKeys) if (!sharedNoteKeys.has(k)) keys.add(k);
  for (const k of imageKeys) if (!sharedImageKeys.has(k)) keys.add(k);
  // lesson-images/<hash> pictures are keyed by the scene description, not the
  // account (services/lesson-images.ts): anyone's lesson or the catalogue
  // sample with that prompt reuses them, so they are never removed here.
  for (const k of lessonImageKeys) if (!sharedLessonKeys.has(k) && !k.startsWith('lesson-images/')) keys.add(k);
  // Only bucket keys, never URLs or the empty string.
  return [...keys].filter((k) => k && !/^https?:\/\//.test(k));
}

async function deleteR2Keys(bucket: R2Bucket, keys: string[]): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    try {
      await bucket.delete(chunk);
      deleted += chunk.length;
    } catch (err) {
      console.error('[delete-user] R2 delete failed for a chunk of', chunk.length, err);
    }
  }
  return deleted;
}

// ---------- Preview / delete ----------

async function countAll(db: D1Database, userId: string, queries: Array<{ key: string; sql: string }>): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const q of queries) {
    const row = await db.prepare(q.sql).bind(userId).first<{ n: number }>();
    out[q.key] = Number(row?.n ?? 0);
  }
  return out;
}

export async function previewUserDeletion(db: D1Database, userId: string, guard: DeletionGuardInput): Promise<DeletionPreview> {
  const user = await getAccountSummary(db, userId);
  if (!user) throw new AccountDeletionError('User not found', 404);
  const [will_delete, will_keep, keys] = await Promise.all([
    countAll(db, userId, PREVIEW_COUNTS),
    countAll(db, userId, KEEP_COUNTS),
    collectR2Keys(db, userId),
  ]);
  return { user, blockers: deletionBlockers(user, guard), will_delete, will_keep, r2_objects: keys.length };
}

export async function deleteUserAccount(
  env: Pick<Env, 'DB' | 'AUDIO_BUCKET'>,
  userId: string,
  guard: DeletionGuardInput & { confirmEmail: string | null | undefined },
  bg?: { waitUntil(p: Promise<unknown>): void }
): Promise<DeletionResult> {
  const user = await getAccountSummary(env.DB, userId);
  if (!user) throw new AccountDeletionError('User not found', 404);
  const blockers = deletionBlockers(user, guard);
  if (blockers.length) throw new AccountDeletionError(blockers.join(' '), 403);
  const expected = (user.email || '').trim().toLowerCase();
  if (!expected || (guard.confirmEmail || '').trim().toLowerCase() !== expected) {
    throw new AccountDeletionError('Type the account\'s email exactly to confirm the deletion.', 400);
  }

  const [kept, keys] = await Promise.all([countAll(env.DB, userId, KEEP_COUNTS), collectR2Keys(env.DB, userId)]);

  // One transaction: all of it or none of it.
  const results = await env.DB.batch(DELETE_STEPS.map((s) => env.DB.prepare(s.sql).bind(userId)));
  const deleted: Record<string, number> = {};
  DELETE_STEPS.forEach((s, i) => {
    const n = Number(results[i]?.meta?.changes ?? 0);
    if (n > 0) deleted[s.label] = n;
  });
  if (!deleted.users) throw new AccountDeletionError('The account was not deleted (it may already be gone).', 409);

  const cleanup = deleteR2Keys(env.AUDIO_BUCKET, keys);
  let r2Deleted = keys.length;
  if (bg) bg.waitUntil(cleanup);
  else r2Deleted = await cleanup;

  console.log('[delete-user] deleted', user.id, user.email, deleted, 'kept', kept, 'r2', keys.length);
  return { deleted_user: user, deleted, kept, r2_objects_deleted: r2Deleted };
}
