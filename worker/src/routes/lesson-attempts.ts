/**
 * Lesson attempts (per-exercise answers + time) and the practice-exercise
 * helpers that need the server. Mounted under /api after the auth middleware.
 *
 *   POST /lessons/sentence-feedback                      Claude checks a sentence_making answer (503 retryable / 502)
 *   PUT  /lesson-attempts/:id/media/:key                 upload a recording made in an attempt (raw body; owner only)
 *   GET  /lesson-attempts[?lesson_id]                    my attempts, newest first
 *   GET  /lesson-attempts/:id                            one of my attempts: spec snapshot, answers, recordings
 *   GET  /relationships/:relId/lesson-attempts[?lesson_id]   tutor: the student's attempts
 *   GET  /relationships/:relId/lesson-attempts/:id           tutor: one attempt
 *
 * Attempts themselves arrive with their completion event on
 * POST /api/custom-lessons/offline-complete (index.ts) — offline-first,
 * idempotent by the event id. Recordings come after, from the device's
 * upload queue; they are transcribed in the background when a transcriber is
 * configured (the same providers as video calls).
 */

import { Hono, Context } from 'hono';
import type { LessonAttemptData, CustomLessonSpec } from '@shared/lesson';
import type { Env } from '../types';
import * as q from '../db/lesson-attempt-queries';
import { storeAudio } from '../services/audio';
import { checkMadeSentence } from '../services/sentence-making';
import { StructuredCallError } from '../services/structured-call';
import { transcribeAudio, pickTranscriber } from '../services/calls/transcribe';
import { verifyRelationshipAccess, getMyRole, getOtherUserId } from '../services/relationships';

type AppEnv = { Bindings: Env };
const lessonAttempts = new Hono<AppEnv>();

const MAX_RECORDING_BYTES = 8 * 1024 * 1024;

// ============ Sentence making: Claude's check ============

lessonAttempts.post('/lessons/sentence-feedback', async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'Claude isn’t set up on this server — check it yourself against the example.', retryable: false }, 503);
  }
  const body = await c.req.json<{ words?: unknown; task?: unknown; sentence?: unknown }>().catch(() => ({} as Record<string, unknown>));
  const words = Array.isArray(body.words) ? body.words.filter((w): w is string => typeof w === 'string' && w.trim().length > 0).slice(0, 6) : [];
  const sentence = typeof body.sentence === 'string' ? body.sentence.trim().slice(0, 300) : '';
  const task = typeof body.task === 'string' ? body.task.slice(0, 300) : undefined;
  if (words.length === 0 || !sentence) return c.json({ error: 'words and sentence are required' }, 400);
  try {
    const feedback = await checkMadeSentence(c.env.ANTHROPIC_API_KEY, { words, task, sentence });
    return c.json({ feedback });
  } catch (error) {
    console.error('[lesson] sentence feedback failed:', error);
    const retryable = !(error instanceof StructuredCallError) || error.retryable;
    return c.json(
      { error: retryable ? 'Claude is busy right now — try again in a moment.' : 'Claude couldn’t check this one.', retryable },
      retryable ? 503 : 502,
    );
  }
});

// ============ Recordings ============

function extensionFor(mime: string): string {
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

lessonAttempts.put('/lesson-attempts/:id/media/:key', async (c) => {
  const userId = c.get('user').id;
  const attemptId = c.req.param('id');
  const mediaKey = c.req.param('key');
  if (!/^[a-z0-9]{1,20}$/i.test(mediaKey)) return c.json({ error: 'Bad media key' }, 400);
  const attempt = await q.getLessonAttempt(c.env.DB, attemptId, userId);
  // 404 until the attempt itself has been uploaded — the client retries next sync.
  if (!attempt) return c.json({ error: 'Attempt not found' }, 404);

  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0) return c.json({ error: 'Empty recording' }, 400);
  if (bytes.byteLength > MAX_RECORDING_BYTES) return c.json({ error: 'Recording too large' }, 413);
  const mime = (c.req.header('Content-Type') || 'audio/webm').split(';')[0].trim();
  const audioKey = `recordings/lessons/${attemptId}/${mediaKey}.${extensionFor(mime)}`;
  await storeAudio(c.env.AUDIO_BUCKET, audioKey, bytes, mime);
  await q.upsertAttemptMedia(c.env.DB, { attempt_id: attemptId, media_key: mediaKey, user_id: userId, audio_key: audioKey, content_type: mime, size: bytes.byteLength });

  c.executionCtx.waitUntil(transcribeAttemptMedia(c.env, attemptId, mediaKey, new Uint8Array(bytes), mime));
  return c.json({ ok: true, audio_url: `/api/audio/${audioKey}` }, 201);
});

/** Transcribe one recording in the background; failures are recorded, never thrown. */
export async function transcribeAttemptMedia(env: Env, attemptId: string, mediaKey: string, bytes: Uint8Array, mime: string): Promise<void> {
  try {
    if (!env.AI && !env.GEMINI_API_KEY && !env.SONIOX_API_KEY) {
      await q.setAttemptMediaTranscript(env.DB, attemptId, mediaKey, 'skipped', null, null);
      return;
    }
    const result = await transcribeAudio(env, pickTranscriber(env), bytes, mime);
    const text = result.segments.map(s => s.text.trim()).filter(Boolean).join(' ');
    const translation = result.segments.map(s => (s.translation ?? '').trim()).filter(Boolean).join(' ');
    await q.setAttemptMediaTranscript(env.DB, attemptId, mediaKey, 'done', text || null, translation || null);
  } catch (error) {
    console.error('[lesson] recording transcription failed:', attemptId, mediaKey, error);
    await q.setAttemptMediaTranscript(env.DB, attemptId, mediaKey, 'failed', null, null).catch(() => {});
  }
}

// ============ Reading attempts ============

async function attemptDetail(env: Env, row: q.LessonAttemptRow) {
  const media = await q.listAttemptMedia(env.DB, row.id);
  return {
    id: row.id,
    lesson_id: row.lesson_id,
    started_at: row.started_at,
    completed_at: row.completed_at,
    duration_ms: row.duration_ms,
    correct: row.correct,
    total: row.total,
    rating: row.rating,
    spec: JSON.parse(row.spec) as CustomLessonSpec,
    data: JSON.parse(row.data) as LessonAttemptData,
    media: media.map(m => ({
      media_key: m.media_key,
      audio_key: m.audio_key,
      audio_url: `/api/audio/${m.audio_key}`,
      content_type: m.content_type,
      transcript_status: m.transcript_status,
      transcript: m.transcript,
      transcript_translation: m.transcript_translation,
    })),
  };
}

lessonAttempts.get('/lesson-attempts', async (c) => {
  const userId = c.get('user').id;
  const attempts = await q.listLessonAttempts(c.env.DB, userId, { lessonId: c.req.query('lesson_id') || undefined });
  return c.json({ attempts });
});

lessonAttempts.get('/lesson-attempts/:id', async (c) => {
  const row = await q.getLessonAttempt(c.env.DB, c.req.param('id'), c.get('user').id);
  if (!row) return c.json({ error: 'Attempt not found' }, 404);
  return c.json({ attempt: await attemptDetail(c.env, row) });
});

/** The student of a relationship the caller tutors, or a Response to return. */
async function studentOf(c: Context<AppEnv>): Promise<{ studentId: string } | Response> {
  const userId = c.get('user').id;
  try {
    const rel = await verifyRelationshipAccess(c.env.DB, c.req.param('relId')!, userId);
    if (getMyRole(rel, userId) !== 'tutor') return c.json({ error: 'Only the tutor can review attempts' }, 403);
    return { studentId: getOtherUserId(rel, userId) };
  } catch {
    return c.json({ error: 'Relationship not found' }, 404);
  }
}

lessonAttempts.get('/relationships/:relId/lesson-attempts', async (c) => {
  const who = await studentOf(c);
  if (who instanceof Response) return who;
  const attempts = await q.listLessonAttempts(c.env.DB, who.studentId, { lessonId: c.req.query('lesson_id') || undefined });
  return c.json({ attempts });
});

lessonAttempts.get('/relationships/:relId/lesson-attempts/:id', async (c) => {
  const who = await studentOf(c);
  if (who instanceof Response) return who;
  const row = await q.getLessonAttempt(c.env.DB, c.req.param('id'), who.studentId);
  if (!row) return c.json({ error: 'Attempt not found' }, 404);
  return c.json({ attempt: await attemptDetail(c.env, row) });
});

export default lessonAttempts;
