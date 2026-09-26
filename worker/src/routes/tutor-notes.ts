/**
 * Session notes → agent jobs (tutor-only). Mounted under /api after the auth
 * middleware, so c.get('user') is always set.
 *
 *   POST   /relationships/:relId/session-notes            { notes, title?, lesson_at?, priority?, auto_share?, log_lesson? } → 202 job
 *   GET    /relationships/:relId/session-notes            { jobs } newest first (no transcripts)
 *   GET    /relationships/:relId/session-notes/:id        the job with steps + result
 *   POST   /relationships/:relId/session-notes/:id/retry  re-queue a failed / cancelled job (resumes from its checkpoint)
 *   POST   /relationships/:relId/session-notes/:id/cancel stop a queued / running job between rounds
 *   DELETE /relationships/:relId/session-notes/:id        forget the job (what it created stays)
 *
 * The agent itself is services/tutor-notes-agent.ts, run by the
 * tutor-notes-queue consumer in index.ts.
 */

import { Hono } from 'hono';
import type { Env, TutorRelationship } from '../types';
import { verifyRelationshipAccess, getMyRole, getOtherUserId } from '../services/relationships';
import * as jobs from '../db/tutor-notes-queries';
import * as iq from '../db/insights-queries';
import { MAX_NOTES_CHARS } from '../services/tutor-notes-agent';

const tutorNotes = new Hono<{ Bindings: Env }>();

class HttpError extends Error {
  constructor(public status: 400 | 403 | 404 | 409 | 503, message: string) {
    super(message);
  }
}

async function requireTutor(db: D1Database, relId: string, userId: string): Promise<{ rel: TutorRelationship; studentId: string }> {
  let rel: TutorRelationship;
  try {
    rel = await verifyRelationshipAccess(db, relId, userId);
  } catch {
    throw new HttpError(404, 'Relationship not found or not active');
  }
  if (getMyRole(rel, userId) !== 'tutor') throw new HttpError(403, 'Only the tutor can send session notes');
  return { rel, studentId: getOtherUserId(rel, userId) };
}

function errorResponse(c: { json: (body: unknown, status?: number) => Response }, error: unknown, fallback: string): Response {
  if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
  const message = error instanceof Error ? error.message : fallback;
  console.error('[tutor-notes]', message);
  return c.json({ error: message }, 500);
}

/** What the client sees: the row minus the transcript. */
function jobJson(job: jobs.TutorNotesJob) {
  const { transcript: _transcript, ...rest } = job;
  return { ...rest, auto_share: !!job.auto_share, notes_chars: job.notes.length };
}

/** At most this many jobs may be queued or running per student at once. */
const MAX_ACTIVE_JOBS = 2;

interface SubmitBody {
  notes?: string;
  title?: string;
  lesson_at?: string;
  priority?: string;
  auto_share?: boolean;
  log_lesson?: boolean;
}

tutorNotes.post('/relationships/:relId/session-notes', async (c) => {
  try {
    const relId = c.req.param('relId');
    const tutor = c.get('user');
    const { studentId } = await requireTutor(c.env.DB, relId, tutor.id);
    if (!c.env.ANTHROPIC_API_KEY) throw new HttpError(503, 'The session-notes assistant is not configured on this server (missing ANTHROPIC_API_KEY)');
    if (!c.env.TUTOR_NOTES_QUEUE) throw new HttpError(503, 'The session-notes queue is not configured on this server');

    const body = await c.req.json<SubmitBody>().catch(() => ({} as SubmitBody));
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
    if (notes.length < 20) throw new HttpError(400, 'Paste the notes from the session (at least a few lines)');
    if (notes.length > MAX_NOTES_CHARS * 2) throw new HttpError(400, `Notes are too long (max ${MAX_NOTES_CHARS * 2} characters)`);

    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : null;
    const priority: jobs.TutorNotesPriority = body.priority === 'non_urgent' ? 'non_urgent' : 'core';
    const autoShare = body.auto_share !== false;
    const logLesson = body.log_lesson !== false;

    let lessonAt: string | null = null;
    if (typeof body.lesson_at === 'string' && body.lesson_at.trim()) {
      let value = body.lesson_at.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) value = `${value}T12:00:00.000Z`;
      if (isNaN(new Date(value).getTime())) throw new HttpError(400, 'lesson_at must be an ISO date');
      lessonAt = new Date(value).toISOString();
    }

    const active = await jobs.countRunningJobs(c.env.DB, relId);
    if (active >= MAX_ACTIVE_JOBS) throw new HttpError(409, 'Two sets of notes are already being worked on for this student — wait for one to finish');

    // The notes are a lesson: log it (anchors "since last lesson" in Insights)
    // and hand the text to the student's Lesson Notes like the manual log does.
    let lessonLogId: string | null = null;
    if (logLesson) {
      const at = lessonAt ?? new Date().toISOString();
      const entry = await iq.createLessonLogEntry(c.env.DB, {
        relationship_id: relId,
        tutor_id: tutor.id,
        student_id: studentId,
        lesson_at: at,
        notes: title ? `${title}\n${notes}` : notes,
      });
      lessonLogId = entry.id;
      const tutorName = tutor.name || tutor.email || 'your tutor';
      const excerpt = notes.length > 6000 ? `${notes.slice(0, 6000)}…` : notes;
      await iq.createStudentLessonNote(c.env.DB, studentId, `[From tutor ${tutorName}, ${at.slice(0, 10)}]\n${title ? `${title}\n` : ''}${excerpt}`, at.slice(0, 10));
    }

    const job = await jobs.createJob(c.env.DB, {
      relationship_id: relId,
      tutor_id: tutor.id,
      student_id: studentId,
      title,
      notes,
      lesson_at: lessonAt,
      priority,
      auto_share: autoShare,
      lesson_log_id: lessonLogId,
    });
    await c.env.TUTOR_NOTES_QUEUE.send({ jobId: job.id });
    return c.json({ job: jobJson(job) }, 202);
  } catch (error) {
    return errorResponse(c, error, 'Failed to submit the session notes');
  }
});

tutorNotes.get('/relationships/:relId/session-notes', async (c) => {
  try {
    const relId = c.req.param('relId');
    await requireTutor(c.env.DB, relId, c.get('user').id);
    const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50));
    const list = await jobs.listJobs(c.env.DB, relId, limit);
    return c.json({ jobs: list.map(jobJson) });
  } catch (error) {
    return errorResponse(c, error, 'Failed to list session notes');
  }
});

tutorNotes.get('/relationships/:relId/session-notes/:id', async (c) => {
  try {
    const relId = c.req.param('relId');
    await requireTutor(c.env.DB, relId, c.get('user').id);
    const job = await jobs.getJobInRelationship(c.env.DB, relId, c.req.param('id'));
    if (!job) throw new HttpError(404, 'Job not found');
    return c.json({ job: jobJson(job) });
  } catch (error) {
    return errorResponse(c, error, 'Failed to load the job');
  }
});

tutorNotes.post('/relationships/:relId/session-notes/:id/retry', async (c) => {
  try {
    const relId = c.req.param('relId');
    await requireTutor(c.env.DB, relId, c.get('user').id);
    if (!c.env.ANTHROPIC_API_KEY || !c.env.TUTOR_NOTES_QUEUE) throw new HttpError(503, 'The session-notes assistant is not configured on this server');
    const job = await jobs.getJobInRelationship(c.env.DB, relId, c.req.param('id'));
    if (!job) throw new HttpError(404, 'Job not found');
    if (job.status === 'queued' || job.status === 'running') throw new HttpError(409, 'This job is still running');
    if (job.status === 'done') throw new HttpError(409, 'This job already finished');
    // A job that ran out of rounds starts over; anything else resumes from its checkpoint.
    const fresh = job.rounds >= 30;
    await jobs.patchJob(c.env.DB, job.id, {
      status: 'queued',
      error: null,
      progress: fresh ? 'Starting over' : 'Waiting to resume',
      finished_at: null,
      ...(fresh ? { transcript: null, rounds: 0 } : {}),
      steps: [...job.steps, { at: new Date().toISOString(), kind: 'info', text: fresh ? 'Retried from the start' : 'Retried' }],
    });
    await c.env.TUTOR_NOTES_QUEUE.send({ jobId: job.id, resume: !fresh });
    const updated = await jobs.getJobInRelationship(c.env.DB, relId, job.id);
    return c.json({ job: jobJson(updated!) }, 202);
  } catch (error) {
    return errorResponse(c, error, 'Failed to retry the job');
  }
});

tutorNotes.post('/relationships/:relId/session-notes/:id/cancel', async (c) => {
  try {
    const relId = c.req.param('relId');
    await requireTutor(c.env.DB, relId, c.get('user').id);
    const job = await jobs.getJobInRelationship(c.env.DB, relId, c.req.param('id'));
    if (!job) throw new HttpError(404, 'Job not found');
    if (job.status !== 'queued' && job.status !== 'running') throw new HttpError(409, 'This job is not running');
    await jobs.patchJob(c.env.DB, job.id, {
      status: 'cancelled',
      progress: 'Cancelled',
      finished_at: new Date().toISOString(),
      steps: [...job.steps, { at: new Date().toISOString(), kind: 'warn', text: 'Cancelled by the tutor' }],
    });
    const updated = await jobs.getJobInRelationship(c.env.DB, relId, job.id);
    return c.json({ job: jobJson(updated!) });
  } catch (error) {
    return errorResponse(c, error, 'Failed to cancel the job');
  }
});

tutorNotes.delete('/relationships/:relId/session-notes/:id', async (c) => {
  try {
    const relId = c.req.param('relId');
    await requireTutor(c.env.DB, relId, c.get('user').id);
    const job = await jobs.getJobInRelationship(c.env.DB, relId, c.req.param('id'));
    if (!job) throw new HttpError(404, 'Job not found');
    if (job.status === 'queued' || job.status === 'running') throw new HttpError(409, 'Cancel the job before deleting it');
    await jobs.deleteJob(c.env.DB, relId, job.id);
    return c.json({ success: true });
  } catch (error) {
    return errorResponse(c, error, 'Failed to delete the job');
  }
});

export { tutorNotes as tutorNotesRoutes };
