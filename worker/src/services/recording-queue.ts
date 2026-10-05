/**
 * Rows → the tutor's "Needs your ear" queue (shared/recordings/queue.ts decides membership).
 * Pure; the route (routes/insights.ts) fetches the rows.
 */
import {
  parseCharScores,
  queueVerdict,
  weakChars,
  type RecordingCheck,
  type RecordingQueueItem,
} from '@shared/recordings/queue';
import type { RecordingQueueRow } from '../db/insights-queries';

type Flag = { id: string; note_id: string; card_id: string | null; message: string; created_at: string };

export function buildRecordingQueue(rows: RecordingQueueRow[], flags: Flag[]): RecordingQueueItem[] {
  const flagByNote = new Map<string, Flag>();
  for (const f of flags) if (!flagByNote.has(f.note_id)) flagByNote.set(f.note_id, f);
  return rows.map((r) => {
    const check: RecordingCheck | null = r.check_status
      ? {
          status: r.check_status === 'done' ? 'done' : r.check_status === 'failed' ? 'failed' : 'pending',
          transcript: r.transcript,
          transcript_match: r.transcript_match == null ? null : r.transcript_match === 1,
          score: r.score,
          char_scores: parseCharScores(r.char_scores),
        }
      : null;
    const flag = flagByNote.get(r.note_id) ?? null;
    const marked = !!r.mark_status;
    const verdict = queueVerdict({ rating: r.rating, check, flagged: !!flag, marked });
    return {
      event_id: r.event_id,
      note: { id: r.note_id, hanzi: r.hanzi, pinyin: r.pinyin, english: r.english, deck_name: r.deck_name, audio_url: r.note_audio_url },
      card_type: r.card_type,
      rating: r.rating,
      reviewed_at: r.reviewed_at,
      recording_url: r.recording_url,
      user_answer: r.user_answer,
      mark: r.mark_status ? { status: r.mark_status, comment: r.mark_comment, updated_at: r.mark_updated_at ?? '' } : null,
      check: check ? { ...check, weak_chars: weakChars(check.char_scores), score_note: r.score_note } : null,
      flag: flag ? { id: flag.id, message: flag.message, created_at: flag.created_at } : null,
      ...verdict,
    };
  });
}
