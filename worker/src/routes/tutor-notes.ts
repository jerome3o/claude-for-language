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
 *   POST   /calls/:id/homework                           { priority?, auto_share?, log_lesson? } → 202 job from the call's transcript / board / chat / report
 *   GET    /calls/:id/homework                           { jobs } made from this call
 *
 * The agent itself is services/tutor-notes-agent.ts, run by the
 * tutor-notes-queue consumer in index.ts.
 */

import { Hono } from 'hono';
import type { Env, TutorRelationship } from '../types';
import { verifyRelationshipAccess, getMyRole, getOtherUserId } from '../services/relationships';
import * as jobs from '../db/tutor-notes-queries';
import { submitSessionNotes, SubmitError, callNotesFor } from '../services/tutor-notes-submit';
import { requireCall, getParticipants, CallError } from '../services/calls/store';

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
  if (error instanceof HttpError || error instanceof SubmitError) return c.json({ error: error.message }, error.status);
  if (error instanceof CallError) return c.json({ error: error.message }, error.status);
  const message = error instanceof Error ? error.message : fallback;
  console.error('[tutor-notes]', message);
  return c.json({ error: message }, 500);
}

/** What the client sees: the row minus the transcript. */
function jobJson(job: jobs.TutorNotesJob) {
  const { transcript: _transcript, ...rest } = job;
  return { ...rest, auto_share: !!job.auto_share, notes_chars: job.notes.length };
}

interface SubmitBody {
  notes?: string;
  title?: string;
  lesson_at?: string;
  priority?: string;
  auto_share?: boolean;
  log_lesson?: boolean;
}

function parseLessonAt(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) value = `${value}T12:00:00.000Z`;
  if (isNaN(new Date(value).getTime())) throw new HttpError(400, 'lesson_at must be an ISO date');
  return new Date(value).toISOString();
}

tutorNotes.post('/relationships/:relId/session-notes', async (c) => {
  try {
    const relId = c.req.param('relId');
    const tutor = c.get('user');
    const { studentId } = await requireTutor(c.env.DB, relId, tutor.id);
    const body = await c.req.json<SubmitBody>().catch(() => ({} as SubmitBody));
    const job = await submitSessionNotes(c.env, {
      relationshipId: relId,
      tutor,
      studentId,
      notes: typeof body.notes === 'string' ? body.notes : '',
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : null,
      lessonAt: parseLessonAt(body.lesson_at),
      priority: body.priority === 'non_urgent' ? 'non_urgent' : 'core',
      autoShare: body.auto_share !== false,
      logLesson: body.log_lesson !== false,
    });
    return c.json({ job: jobJson(job) }, 202);
  } catch (error) {
    return errorResponse(c, error, 'Failed to submit the session notes');
  }
});

// ============ Homework from a recorded video lesson ============

/**
 * The call's transcript (+ whiteboard text, chat, lesson report) becomes the
 * session notes of a job. Only the tutor of the call's relationship may start
 * one; a call whose material is still being processed is refused.
 */
tutorNotes.post('/calls/:id/homework', async (c) => {
  try {
    const tutor = c.get('user');
    const call = await requireCall(c.env.DB, c.req.param('id'), tutor.id);
    if (!call.relationship_id) throw new HttpError(400, 'This call is not part of a tutor–student connection');
    const { studentId } = await requireTutor(c.env.DB, call.relationship_id, tutor.id);
    if (call.status === 'live') throw new HttpError(409, 'The call is still live — end it first');
    if (call.processing_status === 'waiting_uploads' || call.processing_status === 'transcribing' || call.processing_status === 'summarizing') {
      throw new HttpError(409, 'The recording is still being transcribed — try again in a minute');
    }
    const existing = (await jobs.listJobsForCall(c.env.DB, call.id)).find((j) => j.status === 'queued' || j.status === 'running');
    if (existing) return c.json({ job: jobJson(existing), existing: true }, 200);

    const participants = await getParticipants(c.env.DB, call);
    const { notes } = await callNotesFor(c.env, call, participants);
    if (!notes) throw new HttpError(400, 'Nothing was transcribed or written in this call yet');

    const body = await c.req.json<SubmitBody>().catch(() => ({} as SubmitBody));
    const other = participants.find((p) => p.id !== tutor.id);
    const title = call.title || (other ? `Lesson with ${other.name || other.email.split('@')[0]}` : 'Video lesson');
    const job = await submitSessionNotes(c.env, {
      relationshipId: call.relationship_id,
      tutor,
      studentId,
      notes,
      title: title.slice(0, 120),
      lessonAt: call.started_at ? new Date(call.started_at).toISOString() : null,
      priority: body.priority === 'non_urgent' ? 'non_urgent' : 'core',
      autoShare: body.auto_share !== false,
      logLesson: body.log_lesson !== false,
      sourceCallId: call.id,
    });
    return c.json({ job: jobJson(job) }, 202);
  } catch (error) {
    return errorResponse(c, error, 'Failed to make homework from the call');
  }
});

tutorNotes.get('/calls/:id/homework', async (c) => {
  try {
    const call = await requireCall(c.env.DB, c.req.param('id'), c.get('user').id);
    const list = await jobs.listJobsForCall(c.env.DB, call.id);
    return c.json({ jobs: list.map(jobJson) });
  } catch (error) {
    return errorResponse(c, error, 'Failed to list homework for the call');
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
