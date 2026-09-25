/**
 * Student-side view of tutor recording marks. Mounted under /api in index.ts
 * after the auth middleware, so c.get('user') is always set here.
 *
 *   GET  /me/recording-notes                 unseen needs-work notes on my recordings + unseen tutor replies to my flagged cards (kind 'flag')
 *   POST /me/recording-notes/:eventId/seen   I have seen this one (idempotent; a flag id marks the reply seen)
 *
 * The tutor writes the mark from the recordings inbox (routes/insights.ts);
 * the student sees the comment once, on the back of that card, the next time
 * it comes up in study. The client caches the unseen notes in IndexedDB during
 * sync so the line also shows offline, and reports "seen" on the next sync.
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { listUnseenFlagReplies, markFlagReplySeen } from '../services/card-flags';

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

export default recordingNotes;
