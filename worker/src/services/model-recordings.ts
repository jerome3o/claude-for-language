/**
 * The tutor's model recording on a needs-work mark (docs/RECORDING_REVIEW.md "Model recordings").
 *
 * When the tutor marks one of the student's pronunciation takes "needs work" she can also record
 * how it should sound. The clip lives in R2 under `tutor-recordings/<relId>/<eventId>-<id>.<ext>`
 * (person-made: never collected by the storage clean-up) and its key on the mark
 * (`tutor_recording_marks.model_audio_key`, migration 0123). It is served ONLY to the two people
 * of that mark — the tutor who made it and the student whose take it is — by
 * `GET /api/recording-marks/:eventId/model-audio` (never by the public /api/audio/*).
 *
 * The student hears it on the back of that card next to their own take ("▶ Minghui says it" /
 * "▶ You"), on the Tutor notes page and its Practice route; the apps cache it during sync.
 *
 * Removed when the mark is cleared, when it becomes "listened", when a new clip replaces it,
 * and by account deletion (services/admin/delete-user.ts).
 */

import { AUDIO_EXT, sniffAudio, type AudioMime } from './chat/media';

export const MODEL_RECORDING_PREFIX = 'tutor-recordings/';
/** A few seconds of speech is ~50 KB of Opus; 2 MB leaves room for WAV from a phone. */
export const MODEL_RECORDING_MAX_BYTES = 2 * 1024 * 1024;
/** A model answer is a word or a sentence — not a lecture. */
export const MODEL_RECORDING_MAX_MS = 60_000;

export class ModelRecordingError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 413 | 415) {
    super(message);
    this.name = 'ModelRecordingError';
  }
}

export function modelRecordingKey(relId: string, eventId: string, id: string, ext: string): string {
  return `${MODEL_RECORDING_PREFIX}${relId}/${eventId}-${id}.${ext}`;
}

/**
 * The URL both apps fetch (with the session) — `v` changes with every new clip, so a device
 * cache keyed by the URL never plays an old take.
 */
export function modelAudioUrl(eventId: string, key: string | null | undefined): string | null {
  if (!key) return null;
  const file = key.slice(key.lastIndexOf('/') + 1);
  const v = file.slice(file.lastIndexOf('-') + 1).replace(/\.[a-z0-9]+$/i, '');
  return `/api/recording-marks/${encodeURIComponent(eventId)}/model-audio?v=${encodeURIComponent(v)}`;
}

/** `?duration_ms=` from the client: a whole number of ms, or null. Over the cap → error. */
export function parseModelDurationMs(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  const ms = Math.round(n);
  if (ms > MODEL_RECORDING_MAX_MS) throw new ModelRecordingError('Keep the recording under a minute.', 400);
  return ms;
}

/** Check an upload: size, then the container from the first bytes. */
export function inspectModelRecording(bytes: Uint8Array): { mime: AudioMime; ext: string } {
  if (bytes.length === 0) throw new ModelRecordingError('The recording is empty.', 400);
  if (bytes.length > MODEL_RECORDING_MAX_BYTES) throw new ModelRecordingError('The recording is too long (2 MB at most).', 413);
  const mime = sniffAudio(bytes);
  if (!mime) throw new ModelRecordingError("That isn't an audio recording.", 415);
  return { mime, ext: AUDIO_EXT[mime] };
}

interface MarkAudioRow {
  status: 'listened' | 'needs_work';
  model_audio_key: string | null;
}

async function loadMark(db: D1Database, eventId: string): Promise<MarkAudioRow | null> {
  return db
    .prepare(`SELECT status, model_audio_key FROM tutor_recording_marks WHERE review_event_id = ?`)
    .bind(eventId)
    .first<MarkAudioRow>();
}

async function deleteObject(bucket: R2Bucket, key: string | null | undefined): Promise<void> {
  if (!key || !key.startsWith(MODEL_RECORDING_PREFIX)) return;
  try {
    await bucket.delete(key);
  } catch (err) {
    console.error('[model-recordings] R2 delete failed', err);
  }
}

/**
 * Store the tutor's clip on an existing NEEDS-WORK mark (the caller has checked she is the
 * student's tutor and the take is the student's). A new clip makes the note new again for the
 * student (`student_seen_at` cleared), so it shows on the card back once more.
 */
export async function saveModelRecording(
  env: { DB: D1Database; AUDIO_BUCKET: R2Bucket },
  input: { relId: string; eventId: string; tutorId: string; bytes: Uint8Array; durationMs: number | null }
): Promise<{ key: string; mime: AudioMime }> {
  const mark = await loadMark(env.DB, input.eventId);
  if (!mark) throw new ModelRecordingError('Mark the recording "Needs work" first.', 409);
  if (mark.status !== 'needs_work') throw new ModelRecordingError('A model recording goes with a "Needs work" mark.', 409);
  const { mime, ext } = inspectModelRecording(input.bytes);
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const key = modelRecordingKey(input.relId, input.eventId, id, ext);
  await env.AUDIO_BUCKET.put(key, input.bytes, { httpMetadata: { contentType: mime } });
  await env.DB.prepare(
    `UPDATE tutor_recording_marks
     SET model_audio_key = ?, model_audio_mime = ?, model_audio_ms = ?, tutor_id = ?,
         student_seen_at = NULL, updated_at = datetime('now')
     WHERE review_event_id = ?`
  )
    .bind(key, mime, input.durationMs, input.tutorId, input.eventId)
    .run();
  if (mark.model_audio_key && mark.model_audio_key !== key) await deleteObject(env.AUDIO_BUCKET, mark.model_audio_key);
  return { key, mime };
}

/** Take the clip off the mark (the mark itself stays). Returns whether there was one. */
export async function removeModelRecording(env: { DB: D1Database; AUDIO_BUCKET: R2Bucket }, eventId: string): Promise<boolean> {
  const mark = await loadMark(env.DB, eventId);
  if (!mark?.model_audio_key) return false;
  await env.DB.prepare(
    `UPDATE tutor_recording_marks SET model_audio_key = NULL, model_audio_mime = NULL, model_audio_ms = NULL WHERE review_event_id = ?`
  )
    .bind(eventId)
    .run();
  await deleteObject(env.AUDIO_BUCKET, mark.model_audio_key);
  return true;
}

/** The key a mark holds right now (to delete its object after the mark row goes). */
export async function modelRecordingKeyOf(db: D1Database, eventId: string): Promise<string | null> {
  return (await loadMark(db, eventId))?.model_audio_key ?? null;
}

export { deleteObject as deleteModelRecordingObject };

/** Who may hear a mark's clip: the tutor who made the mark, or the student whose take it is. */
export async function loadModelRecordingFor(
  db: D1Database,
  eventId: string,
  userId: string
): Promise<{ key: string; mime: string | null } | null> {
  const row = await db
    .prepare(
      `SELECT m.model_audio_key AS key, m.model_audio_mime AS mime, m.tutor_id, re.user_id AS student_id
       FROM tutor_recording_marks m
       JOIN review_events re ON re.id = m.review_event_id
       WHERE m.review_event_id = ?`
    )
    .bind(eventId)
    .first<{ key: string | null; mime: string | null; tutor_id: string; student_id: string }>();
  if (!row?.key) return null;
  if (row.tutor_id !== userId && row.student_id !== userId) return null;
  return { key: row.key, mime: row.mime };
}
