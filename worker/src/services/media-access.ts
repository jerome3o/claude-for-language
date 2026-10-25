/**
 * May this user see this PRIVATE R2 object? (shared/media/access.ts, docs/AUDIO.md "Private media")
 *
 * Asked by GET /api/audio/* for a request that carries a media token or the session (not a signed
 * link — the API checked before minting that), and by POST /api/media/sign before minting.
 *
 *   recordings/lessons/…  a mini-lesson answer: the learner, or their tutor
 *   recordings/messages/… an (old) chat voice message: the two people of that chat
 *   recordings/…          a study-card take or a recorded note pronunciation: the person whose
 *                         review / note it is (every owner of a note using the clip), or their tutor
 *   calls/<callId>/…      call audio: the call's members (both sides of the relationship / the caller)
 *   note-uploads/…        an uploaded card picture: every owner of a note showing it, or their tutor
 *   lesson-notes/…        a lesson-note file: its owner
 *   feedback/…            an in-app feedback screenshot: its author, or an admin (docs/FEEDBACK.md)
 *
 * "Their tutor" = the other side of an ACTIVE relationship in which the caller is the tutor.
 */
import { mediaAccessOf, mediaKeyOf } from '@shared/media/access';
import { callMemberIds, getCall } from './calls/store';

async function isTutorOfAny(db: D1Database, tutorId: string, ownerIds: string[]): Promise<boolean> {
  const others = [...new Set(ownerIds)].filter((id) => id && id !== tutorId).slice(0, 50);
  if (others.length === 0) return false;
  const qs = others.map(() => '?').join(',');
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM tutor_relationships
        WHERE status = 'active'
          AND ((requester_id = ? AND requester_role = 'tutor' AND recipient_id IN (${qs}))
            OR (recipient_id = ? AND requester_role = 'student' AND requester_id IN (${qs})))
        LIMIT 1`,
    )
    .bind(tutorId, ...others, tutorId, ...others)
    .first<{ ok: number }>();
  return !!row;
}

async function ownerOrTutor(db: D1Database, userId: string, ownerIds: string[]): Promise<boolean> {
  if (ownerIds.includes(userId)) return true;
  return isTutorOfAny(db, userId, ownerIds);
}

async function ids(db: D1Database, sql: string, ...binds: unknown[]): Promise<string[]> {
  const res = await db.prepare(sql).bind(...binds).all<{ id: string | null }>();
  return (res.results ?? []).map((r) => r.id).filter((v): v is string => !!v);
}

/** The owners of notes that use this key as word / sentence clip or picture (a tutor's note and its copies share keys). */
function noteOwners(db: D1Database, key: string, column: 'audio' | 'image'): Promise<string[]> {
  const where = column === 'image' ? 'n.image_key = ?1' : '(n.audio_url = ?1 OR n.sentence_clue_audio_url = ?1)';
  return ids(db, `SELECT DISTINCT d.user_id AS id FROM notes n JOIN decks d ON d.id = n.deck_id WHERE ${where} LIMIT 50`, key);
}

export async function canAccessMedia(db: D1Database, userId: string, keyOrUrl: string): Promise<boolean> {
  const key = mediaKeyOf(keyOrUrl);
  if (mediaAccessOf(key) !== 'private' || !userId) return false;

  if (key.startsWith('recordings/lessons/')) {
    const owners = await ids(db, 'SELECT user_id AS id FROM custom_lesson_attempt_media WHERE audio_key = ? LIMIT 5', key);
    return ownerOrTutor(db, userId, owners);
  }
  if (key.startsWith('recordings/messages/')) {
    const row = await db
      .prepare(
        `SELECT r.requester_id AS a, r.recipient_id AS b FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           JOIN tutor_relationships r ON r.id = c.relationship_id
          WHERE m.recording_url = ? LIMIT 1`,
      )
      .bind(key)
      .first<{ a: string; b: string }>();
    return !!row && (row.a === userId || row.b === userId);
  }
  if (key.startsWith('recordings/')) {
    const [reviewers, noteRecorders, notes] = await Promise.all([
      ids(db, 'SELECT user_id AS id FROM review_events WHERE recording_url = ? LIMIT 5', key),
      ids(
        db,
        `SELECT DISTINCT d.user_id AS id FROM note_audio_recordings r
           JOIN notes n ON n.id = r.note_id JOIN decks d ON d.id = n.deck_id
          WHERE r.audio_url = ? LIMIT 50`,
        key,
      ),
      noteOwners(db, key, 'audio'),
    ]);
    return ownerOrTutor(db, userId, [...reviewers, ...noteRecorders, ...notes]);
  }
  if (key.startsWith('calls/')) {
    const callId = key.split('/')[1];
    if (!callId) return false;
    const call = await getCall(db, callId);
    if (!call) return false;
    return (await callMemberIds(db, call)).includes(userId);
  }
  if (key.startsWith('note-uploads/')) {
    return ownerOrTutor(db, userId, await noteOwners(db, key, 'image'));
  }
  if (key.startsWith('lesson-notes/')) {
    const owners = await ids(
      db,
      'SELECT ln.user_id AS id FROM lesson_note_files f JOIN lesson_notes ln ON ln.id = f.lesson_note_id WHERE f.r2_key = ? LIMIT 5',
      key,
    );
    return owners.includes(userId);
  }
  if (key.startsWith('feedback/')) {
    const row = await db.prepare('SELECT user_id FROM feature_requests WHERE screenshot_key = ? LIMIT 1').bind(key).first<{ user_id: string }>();
    const owner = row?.user_id;
    if (!owner) return false;
    if (owner === userId) return true;
    const me = await db.prepare('SELECT is_admin FROM users WHERE id = ?').bind(userId).first<{ is_admin: number | null }>();
    return !!me?.is_admin;
  }
  return false;
}
