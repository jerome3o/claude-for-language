/**
 * Student-side view of tutor recording marks. Mounted under /api in index.ts
 * after the auth middleware, so c.get('user') is always set here.
 *
 *   GET  /me/recording-notes                 unseen needs-work notes on my recordings
 *   POST /me/recording-notes/:eventId/seen   I have seen this one (idempotent)
 *
 * The tutor writes the mark from the recordings inbox (routes/insights.ts);
 * the student sees the comment once, on the back of that card, the next time
 * it comes up in study. The client caches the unseen notes in IndexedDB during
 * sync so the line also shows offline, and reports "seen" on the next sync.
 */

import { Hono } from 'hono';
import type { Env } from '../types';

const recordingNotes = new Hono<{ Bindings: Env }>();

export interface StudentRecordingNote {
  /** The review event (recording) the note is on */
  event_id: string;
  card_id: string;
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
    return c.json({ notes: res.results || [] });
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
    const changed = (result.meta?.changes ?? 0) > 0;
    return c.json({ success: true, updated: changed });
  } catch (error) {
    console.error('[recording-notes] seen failed:', error);
    return c.json({ error: 'Failed to record that the note was seen' }, 500);
  }
});

export default recordingNotes;
