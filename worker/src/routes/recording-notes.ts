/**
 * Student-side view of tutor recording marks. Mounted under /api in index.ts
 * after the auth middleware, so c.get('user') is always set here.
 *
 *   GET  /me/recording-notes                 unseen needs-work notes on my recordings + unseen tutor replies to my flagged cards (kind 'flag')
 *   POST /me/recording-notes/:eventId/seen   I have seen this one (idempotent; a flag id marks the reply seen)
 *   GET  /me/tutor-notes?include_seen=1&limit=&before=
 *                                            the "Notes from your tutor" page: every note (new AND seen),
 *                                            newest first, with the card's pinyin / meaning and my recording
 *
 * The tutor writes the mark from the recordings inbox (routes/insights.ts);
 * the student sees the comment once, on the back of that card, the next time
 * it comes up in study. The client caches the unseen notes in IndexedDB during
 * sync so the line also shows offline, and reports "seen" on the next sync.
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { listUnseenFlagReplies, markFlagReplySeen } from '../services/card-flags';
import { sqliteToIso } from '@shared/chats';

const recordingNotes = new Hono<{ Bindings: Env }>();

export interface StudentRecordingNote {
  /** The review event (recording) the note is on — or the flag id for a tutor's reply to a flagged card */
  event_id: string;
  /** 'recording' = a mark on a recording (default); 'flag' = the tutor's reply to a card the student flagged */
  kind?: 'recording' | 'flag';
  /** Null for a flag the student sent from outside study; the client then matches on note_id */
  card_id: string | null;
  note_id: string;
  hanzi: string;
  comment: string;
  tutor_name: string | null;
  /** When the tutor wrote or last edited the note */
  updated_at: string;
}

recordingNotes.get('/me/recording-notes', async (c) => {
  try {
    const userId = c.get('user').id;
    const res = await c.env.DB.prepare(
      `SELECT m.review_event_id AS event_id, re.card_id, n.id AS note_id, n.hanzi,
              m.comment, u.name AS tutor_name, m.updated_at
       FROM tutor_recording_marks m
       JOIN review_events re ON re.id = m.review_event_id
       JOIN cards c ON c.id = re.card_id
       JOIN notes n ON n.id = c.note_id
       LEFT JOIN users u ON u.id = m.tutor_id
       WHERE re.user_id = ?
         AND m.status = 'needs_work'
         AND m.comment IS NOT NULL AND m.comment != ''
         AND m.student_seen_at IS NULL
       ORDER BY m.updated_at DESC
       LIMIT 200`
    )
      .bind(userId)
      .all<StudentRecordingNote>();
    const replies = await listUnseenFlagReplies(c.env.DB, userId);
    const notes: StudentRecordingNote[] = [
      ...(res.results || []).map((n) => ({ ...n, kind: 'recording' as const })),
      ...replies.map((r) => ({
        event_id: r.flag_id,
        kind: 'flag' as const,
        card_id: r.card_id,
        note_id: r.note_id,
        hanzi: r.hanzi,
        comment: r.reply,
        tutor_name: r.tutor_name,
        updated_at: r.replied_at,
      })),
    ].sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
    return c.json({ notes });
  } catch (error) {
    console.error('[recording-notes] list failed:', error);
    return c.json({ error: 'Failed to load recording notes' }, 500);
  }
});

recordingNotes.post('/me/recording-notes/:eventId/seen', async (c) => {
  try {
    const userId = c.get('user').id;
    const eventId = c.req.param('eventId');
    // Scoped to the caller's own events: a student cannot mark someone
    // else's note as seen. Already-seen rows keep their original timestamp.
    const result = await c.env.DB.prepare(
      `UPDATE tutor_recording_marks
       SET student_seen_at = COALESCE(student_seen_at, datetime('now'))
       WHERE review_event_id = ?
         AND review_event_id IN (SELECT id FROM review_events WHERE user_id = ?)`
    )
      .bind(eventId, userId)
      .run();
    let changed = (result.meta?.changes ?? 0) > 0;
    // Not a recording mark → maybe the tutor's reply to a flagged card (same id space on the client).
    if (!changed) changed = await markFlagReplySeen(c.env.DB, eventId, userId);
    return c.json({ success: true, updated: changed });
  } catch (error) {
    console.error('[recording-notes] seen failed:', error);
    return c.json({ error: 'Failed to record that the note was seen' }, 500);
  }
});

/** One row of the "Notes from your tutor" page (GET /me/tutor-notes). */
export interface StudentTutorNote {
  /** The recording's review event id, or the flag id — the id POST …/seen takes */
  id: string;
  kind: 'recording' | 'flag';
  card_id: string | null;
  card_type: string | null;
  note_id: string;
  deck_id: string | null;
  hanzi: string;
  pinyin: string;
  english: string;
  /** The tutor's comment (recording mark) or reply (flag) */
  comment: string;
  tutor_name: string | null;
  /** ISO — when the tutor wrote or last edited it */
  updated_at: string;
  /** ISO — when I saw it (on the card back or on the notes page); null = new */
  seen_at: string | null;
  /** Recording mark: the R2 key of my recording (played via /api/audio/<key>) */
  recording_url: string | null;
  /** Flag: what I wrote when I flagged the card */
  student_message: string | null;
}

type TutorNoteRow = StudentTutorNote & { sort_at: string };

const TUTOR_NOTES_DEFAULT_LIMIT = 50;
const TUTOR_NOTES_MAX_LIMIT = 200;

/** Cursor = "<sqlite datetime>|<id>" of the last row of the previous page. */
export function parseTutorNotesCursor(raw: string | undefined): { at: string; id: string } | null {
  if (!raw) return null;
  const bar = raw.indexOf('|');
  if (bar <= 0) return null;
  const at = raw.slice(0, bar);
  const id = raw.slice(bar + 1);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(at) && id ? { at, id } : null;
}

/**
 * Every tutor note for the caller, newest first: needs-work comments on MY recordings and my
 * tutors' replies to cards I flagged. `include_seen=1` adds the ones already seen (default: only
 * new ones, like /me/recording-notes). Keyset paging: `before` = the previous page's
 * `next_cursor`. Student-scoped: a recording mark counts only on my own review events, a flag
 * reply only on a flag I sent.
 */
recordingNotes.get('/me/tutor-notes', async (c) => {
  try {
    const userId = c.get('user').id;
    const includeSeen = ['1', 'true'].includes(c.req.query('include_seen') ?? '');
    const limitRaw = parseInt(c.req.query('limit') ?? '', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), TUTOR_NOTES_MAX_LIMIT) : TUTOR_NOTES_DEFAULT_LIMIT;
    const beforeRaw = c.req.query('before');
    const cursor = parseTutorNotesCursor(beforeRaw);
    if (beforeRaw && !cursor) return c.json({ error: 'Invalid cursor' }, 400);

    const markCursor = cursor ? 'AND (datetime(m.updated_at) < ? OR (datetime(m.updated_at) = ? AND m.review_event_id < ?))' : '';
    const flagCursor = cursor ? 'AND (datetime(f.replied_at) < ? OR (datetime(f.replied_at) = ? AND f.id < ?))' : '';
    const cursorArgs = cursor ? [cursor.at, cursor.at, cursor.id] : [];

    const [marks, flags] = await Promise.all([
      c.env.DB.prepare(
        `SELECT m.review_event_id AS id, 'recording' AS kind, re.card_id, c.card_type, n.id AS note_id, n.deck_id,
                n.hanzi, n.pinyin, n.english, m.comment, u.name AS tutor_name,
                m.updated_at, m.student_seen_at AS seen_at, re.recording_url, NULL AS student_message,
                datetime(m.updated_at) AS sort_at
         FROM tutor_recording_marks m
         JOIN review_events re ON re.id = m.review_event_id
         JOIN cards c ON c.id = re.card_id
         JOIN notes n ON n.id = c.note_id
         LEFT JOIN users u ON u.id = m.tutor_id
         WHERE re.user_id = ?
           AND m.status = 'needs_work'
           AND m.comment IS NOT NULL AND m.comment != ''
           ${includeSeen ? '' : 'AND m.student_seen_at IS NULL'}
           ${markCursor}
         ORDER BY datetime(m.updated_at) DESC, m.review_event_id DESC
         LIMIT ?`
      )
        .bind(userId, ...cursorArgs, limit + 1)
        .all<TutorNoteRow>(),
      c.env.DB.prepare(
        `SELECT f.id, 'flag' AS kind, f.card_id, c.card_type, f.note_id, n.deck_id,
                n.hanzi, n.pinyin, n.english, f.tutor_reply AS comment, u.name AS tutor_name,
                f.replied_at AS updated_at, f.student_seen_reply_at AS seen_at, NULL AS recording_url,
                f.message AS student_message, datetime(f.replied_at) AS sort_at
         FROM card_flags f
         JOIN notes n ON n.id = f.note_id
         LEFT JOIN cards c ON c.id = f.card_id
         LEFT JOIN users u ON u.id = f.tutor_id
         WHERE f.student_id = ?
           AND f.tutor_reply IS NOT NULL AND f.tutor_reply != '' AND f.replied_at IS NOT NULL
           ${includeSeen ? '' : 'AND f.student_seen_reply_at IS NULL'}
           ${flagCursor}
         ORDER BY datetime(f.replied_at) DESC, f.id DESC
         LIMIT ?`
      )
        .bind(userId, ...cursorArgs, limit + 1)
        .all<TutorNoteRow>(),
    ]);

    const merged = [...(marks.results || []), ...(flags.results || [])].sort((a, b) =>
      a.sort_at !== b.sort_at ? (a.sort_at < b.sort_at ? 1 : -1) : a.id < b.id ? 1 : a.id > b.id ? -1 : 0
    );
    const page = merged.slice(0, limit);
    const last = page[page.length - 1];
    const notes: StudentTutorNote[] = page.map(({ sort_at: _sortAt, ...row }) => ({
      ...row,
      updated_at: sqliteToIso(row.updated_at),
      seen_at: row.seen_at ? sqliteToIso(row.seen_at) : null,
    }));
    return c.json({
      notes,
      next_cursor: merged.length > limit && last ? `${last.sort_at}|${last.id}` : null,
    });
  } catch (error) {
    console.error('[tutor-notes] list failed:', error);
    return c.json({ error: 'Failed to load tutor notes' }, 500);
  }
});

export default recordingNotes;
