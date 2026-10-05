/**
 * "Review together" — the in-call activity for going through what needs the tutor's ear
 * (docs/RECORDING_REVIEW.md "In the call"; engine: shared/call-activities `review` kind).
 *
 * The CallRoom builds the spec when either person starts it (it rides inside the session, like
 * every activity): the student's "Needs your ear" queue (shared/recordings/queue.ts), their open
 * card flags and the tutor's recent needs-work marks, newest first. A mark made in the call goes
 * through the same writes as the recordings page (tutor_recording_marks) and the flag reply
 * (replyToCardFlag — resolves it, mirrors it into the chat, shown once on the student's card).
 */
import type { ReviewItem, ReviewSpec } from '@shared/call-activities';
import { REVIEW_ACTIVITY_ID } from '@shared/call-activities';
import { fetchOpenFlags, fetchRecordingQueueRows, upsertRecordingMark } from '../../db/insights-queries';
import { buildRecordingQueue } from '../recording-queue';
import { replyToCardFlag, setCardFlagStatus } from '../card-flags';
import { getOtherUserId, verifyRelationshipAccess } from '../relationships';

/** How far back the list looks, and how long it may get. */
export const REVIEW_LOOKBACK_DAYS = 60;
export const NEEDS_WORK_LOOKBACK_DAYS = 30;
export const MAX_REVIEW_ITEMS = 30;

export async function buildReviewSpec(db: D1Database, relationshipId: string, tutorId: string, now = new Date()): Promise<ReviewSpec | null> {
  const rel = await verifyRelationshipAccess(db, relationshipId, tutorId).catch(() => null);
  if (!rel) return null;
  const studentId = getOtherUserId(rel, tutorId);
  const from = new Date(now.getTime() - REVIEW_LOOKBACK_DAYS * 86_400_000).toISOString();
  const needsWorkFrom = new Date(now.getTime() - NEEDS_WORK_LOOKBACK_DAYS * 86_400_000).toISOString();
  const [rows, flags, noteRows] = await Promise.all([
    fetchRecordingQueueRows(db, studentId, from, now.toISOString(), 1000),
    fetchOpenFlags(db, relationshipId),
    db
      .prepare(`SELECT n.id, n.hanzi, n.pinyin, n.english, n.audio_url FROM card_flags f JOIN notes n ON n.id = f.note_id WHERE f.relationship_id = ? AND f.status = 'open'`)
      .bind(relationshipId)
      .all<{ id: string; hanzi: string; pinyin: string; english: string; audio_url: string | null }>(),
  ]);
  const queue = buildRecordingQueue(rows, flags);
  const items: ReviewItem[] = [];
  const seen = new Set<string>();
  const flaggedNotes = new Set<string>();

  for (const q of queue) {
    if (!q.in_queue) continue;
    items.push({
      id: q.event_id,
      source: 'recording',
      event_id: q.event_id,
      flag_id: q.flag?.id ?? null,
      note_id: q.note.id,
      hanzi: q.note.hanzi,
      pinyin: q.note.pinyin,
      english: q.note.english,
      recording_key: q.recording_url,
      reference_key: q.note.audio_url,
      labels: q.labels,
      transcript: q.check?.transcript ?? null,
      weak: (q.check?.weak_chars ?? []).map((w) => ({ char: w.char, kind: w.kind })),
      flag_message: q.flag?.message ?? null,
      mark: null,
      recorded_at: q.reviewed_at,
    });
    seen.add(q.event_id);
    if (q.flag) flaggedNotes.add(q.note.id);
  }

  // Flags on words with no recording in the queue: the newest recording of that word if any.
  const noteById = new Map((noteRows.results ?? []).map((n) => [n.id, n]));
  for (const f of flags) {
    if (flaggedNotes.has(f.note_id)) continue;
    flaggedNotes.add(f.note_id);
    const note = noteById.get(f.note_id);
    if (!note) continue;
    const rec = queue.find((q) => q.note.id === f.note_id);
    items.push({
      id: f.id,
      source: 'flag',
      event_id: rec?.event_id ?? null,
      flag_id: f.id,
      note_id: f.note_id,
      hanzi: note.hanzi,
      pinyin: note.pinyin,
      english: note.english,
      recording_key: rec?.recording_url ?? null,
      reference_key: note.audio_url,
      labels: ['Flagged for you'],
      transcript: rec?.check?.transcript ?? null,
      weak: (rec?.check?.weak_chars ?? []).map((w) => ({ char: w.char, kind: w.kind })),
      flag_message: f.message,
      mark: rec?.mark ? { status: rec.mark.status, comment: rec.mark.comment } : null,
      recorded_at: rec?.reviewed_at ?? null,
    });
    if (rec) seen.add(rec.event_id);
  }

  // The tutor's recent needs-work marks: worth hearing again together.
  for (const q of queue) {
    if (seen.has(q.event_id) || q.mark?.status !== 'needs_work' || (q.mark.updated_at && q.mark.updated_at < needsWorkFrom)) continue;
    items.push({
      id: q.event_id,
      source: 'needs_work',
      event_id: q.event_id,
      flag_id: null,
      note_id: q.note.id,
      hanzi: q.note.hanzi,
      pinyin: q.note.pinyin,
      english: q.note.english,
      recording_key: q.recording_url,
      reference_key: q.note.audio_url,
      labels: [q.mark.comment ? `Needs work: ${q.mark.comment}` : 'You marked it needs work'],
      transcript: q.check?.transcript ?? null,
      weak: (q.check?.weak_chars ?? []).map((w) => ({ char: w.char, kind: w.kind })),
      flag_message: null,
      mark: { status: q.mark.status, comment: q.mark.comment },
      recorded_at: q.reviewed_at,
    });
    seen.add(q.event_id);
  }

  return {
    id: REVIEW_ACTIVITY_ID,
    kind: 'review',
    title: 'Review together',
    title_zh: '一起听',
    level: 'beginner',
    topic: 'pronunciation',
    summary: 'Recordings that need your ear and cards the student flagged — both of you hear every clip.',
    role_names: { a: 'Tutor', b: 'Student' },
    tutor_role: 'a',
    items: items.slice(0, MAX_REVIEW_ITEMS),
  };
}

/** Write a mark made in the call: the recording's mark and/or the flag's reply. Never throws. */
export async function applyReviewMark(
  db: D1Database,
  item: ReviewItem,
  tutorId: string,
  status: 'listened' | 'needs_work',
  comment: string | null
): Promise<void> {
  try {
    if (item.event_id) {
      await upsertRecordingMark(db, { review_event_id: item.event_id, tutor_id: tutorId, status, comment: comment || null });
    }
    if (item.flag_id) {
      if (comment) await replyToCardFlag(db, item.flag_id, tutorId, comment);
      else await setCardFlagStatus(db, item.flag_id, tutorId, 'resolved');
    }
  } catch (err) {
    console.error('[call-room] review mark failed:', item.id, err instanceof Error ? err.message : err);
  }
}
