/**
 * Lesson notes → homework drafts (docs/HOMEWORK.md §4). Tutor only; mounted
 * under /api after the auth middleware.
 *
 *   GET  /relationships/:relId/lesson-notes                      { entries: [{ …log entry, job }] }
 *   POST /relationships/:relId/lesson-notes                      { notes, title?, lesson_at?, draft? } → 201 { entry, job? }
 *   POST /relationships/:relId/lesson-notes/:logId/draft         → 202 { job } (draft homework from an entry)
 *   GET  /relationships/:relId/homework-drafts/:jobId            ?today= → the draft view
 *   PUT  /relationships/:relId/homework-drafts/:jobId/plan       { plan } → the draft view
 *   POST /relationships/:relId/homework-drafts/:jobId/messages   { message } → 202 { job } (the agent revises the draft)
 *   POST /relationships/:relId/homework-drafts/:jobId/assign     { today? } → 201 { assignments, skipped, errors }
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { normalizeDraftPlan } from '@shared/homework';
import * as jobs from '../db/tutor-notes-queries';
import * as iq from '../db/insights-queries';
import { submitSessionNotes, SubmitError } from '../services/tutor-notes-submit';
import { appendTutorRequest, draftContents } from '../services/tutor-notes-agent';
import { buildDraftView, assignDraft } from '../services/homework-drafts';
import { HomeworkError } from '../services/homework';
import { requireTutorOf, homeworkErrorResponse, todayParam } from './homework';

const drafts = new Hono<{ Bindings: Env }>();

function errorResponse(c: { json: (body: unknown, status?: number) => Response }, error: unknown, fallback: string): Response {
  if (error instanceof SubmitError) return c.json({ error: error.message }, error.status);
  return homeworkErrorResponse(c, error, fallback);
}

function parseLessonAt(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) value = `${value}T12:00:00.000Z`;
  if (isNaN(new Date(value).getTime())) throw new HomeworkError(400, 'lesson_at must be an ISO date');
  return new Date(value).toISOString();
}

/** A job as the list shows it: no transcript, no notes body. */
function jobBrief(job: jobs.TutorNotesJob) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    review: !!job.review,
    assigned_at: job.assigned_at,
    error: job.error,
    created_at: job.created_at,
    finished_at: job.finished_at,
    result: job.result,
  };
}

async function draftJob(db: D1Database, relId: string, jobId: string): Promise<jobs.TutorNotesJob> {
  const job = await jobs.getJobInRelationship(db, relId, jobId);
  if (!job) throw new HomeworkError(404, 'Draft not found');
  return job;
}

// ============ Lesson notes ============

drafts.get('/relationships/:relId/lesson-notes', async (c) => {
  try {
    const relId = c.req.param('relId');
    await requireTutorOf(c.env.DB, relId, c.get('user').id);
    const [entries, list] = await Promise.all([iq.listLessonLog(c.env.DB, relId, 100), jobs.listJobsForLessonLogs(c.env.DB, relId)]);
    const byEntry = new Map<string, jobs.TutorNotesJob>();
    for (const j of list) if (j.lesson_log_id && !byEntry.has(j.lesson_log_id)) byEntry.set(j.lesson_log_id, j); // newest first
    return c.json({
      entries: entries.map((e) => {
        const job = byEntry.get(e.id);
        return { ...e, job: job ? jobBrief(job) : null };
      }),
    });
  } catch (error) {
    return errorResponse(c, error, 'Failed to load lesson notes');
  }
});

drafts.post('/relationships/:relId/lesson-notes', async (c) => {
  try {
    const relId = c.req.param('relId');
    const tutor = c.get('user');
    const { studentId } = await requireTutorOf(c.env.DB, relId, tutor.id);
    const body = await c.req.json<{ notes?: unknown; title?: unknown; lesson_at?: unknown; draft?: unknown }>().catch(() => ({} as Record<string, unknown>));
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : null;
    const lessonAt = parseLessonAt(body.lesson_at);
    if (!notes) throw new HomeworkError(400, 'Write or paste the notes from the lesson');
    if (body.draft !== false) {
      const job = await submitSessionNotes(c.env, {
        relationshipId: relId,
        tutor,
        studentId,
        notes,
        title,
        lessonAt,
        priority: 'core',
        autoShare: false,
        logLesson: true,
        review: true,
      });
      const entry = (await iq.listLessonLog(c.env.DB, relId, 100)).find((e) => e.id === job.lesson_log_id) ?? null;
      return c.json({ entry, job: jobBrief(job) }, 201);
    }
    const at = lessonAt ?? new Date().toISOString();
    const entry = await iq.createLessonLogEntry(c.env.DB, { relationship_id: relId, tutor_id: tutor.id, student_id: studentId, lesson_at: at, notes: title ? `${title}\n${notes}` : notes, title });
    const tutorName = tutor.name || tutor.email || 'your tutor';
    await iq.createStudentLessonNote(c.env.DB, studentId, `[From tutor ${tutorName}, ${at.slice(0, 10)}]\n${title ? `${title}\n` : ''}${notes.slice(0, 6000)}`, at.slice(0, 10));
    return c.json({ entry, job: null }, 201);
  } catch (error) {
    return errorResponse(c, error, 'Failed to save the lesson notes');
  }
});

drafts.post('/relationships/:relId/lesson-notes/:logId/draft', async (c) => {
  try {
    const relId = c.req.param('relId');
    const tutor = c.get('user');
    const { studentId } = await requireTutorOf(c.env.DB, relId, tutor.id);
    const entry = (await iq.listLessonLog(c.env.DB, relId, 400)).find((e) => e.id === c.req.param('logId'));
    if (!entry) throw new HomeworkError(404, 'Lesson notes not found');
    const title = entry.title ?? null;
    const raw = entry.notes ?? '';
    const notes = title && raw.startsWith(`${title}\n`) ? raw.slice(title.length + 1) : raw;
    const job = await submitSessionNotes(c.env, {
      relationshipId: relId,
      tutor,
      studentId,
      notes,
      title,
      lessonAt: entry.lesson_at,
      priority: 'core',
      autoShare: false,
      logLesson: false,
      review: true,
      lessonLogId: entry.id,
    });
    return c.json({ job: jobBrief(job) }, 202);
  } catch (error) {
    return errorResponse(c, error, 'Failed to start the draft');
  }
});

// ============ The draft ============

drafts.get('/relationships/:relId/homework-drafts/:jobId', async (c) => {
  try {
    const relId = c.req.param('relId');
    await requireTutorOf(c.env.DB, relId, c.get('user').id);
    const job = await draftJob(c.env.DB, relId, c.req.param('jobId'));
    return c.json(await buildDraftView(c.env, job, todayParam(c.req.query('today'))));
  } catch (error) {
    return errorResponse(c, error, 'Failed to load the draft');
  }
});

drafts.put('/relationships/:relId/homework-drafts/:jobId/plan', async (c) => {
  try {
    const relId = c.req.param('relId');
    await requireTutorOf(c.env.DB, relId, c.get('user').id);
    const job = await draftJob(c.env.DB, relId, c.req.param('jobId'));
    if (job.assigned_at) throw new HomeworkError(409, 'This draft was already assigned');
    const body = await c.req.json<{ plan?: unknown; today?: unknown }>().catch(() => ({} as { plan?: unknown; today?: unknown }));
    const today = todayParam(body.today);
    const plan = normalizeDraftPlan(body.plan, draftContents(job.result), today);
    await jobs.patchJob(c.env.DB, job.id, { plan });
    return c.json(await buildDraftView(c.env, { ...job, plan }, today));
  } catch (error) {
    return errorResponse(c, error, 'Failed to save the plan');
  }
});

drafts.post('/relationships/:relId/homework-drafts/:jobId/messages', async (c) => {
  try {
    const relId = c.req.param('relId');
    await requireTutorOf(c.env.DB, relId, c.get('user').id);
    if (!c.env.ANTHROPIC_API_KEY || !c.env.TUTOR_NOTES_QUEUE) {
      return c.json({ error: 'The homework assistant is not configured on this server (missing ANTHROPIC_API_KEY) — edit the draft by hand instead.' }, 503);
    }
    const job = await draftJob(c.env.DB, relId, c.req.param('jobId'));
    if (job.status === 'queued' || job.status === 'running') throw new HomeworkError(409, 'The assistant is still working on this draft');
    if (job.assigned_at) throw new HomeworkError(409, 'This draft was already assigned');
    const body = await c.req.json<{ message?: unknown }>().catch(() => ({} as { message?: unknown }));
    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 4000) : '';
    if (!message) throw new HomeworkError(400, 'Write a message');
    const at = new Date().toISOString();
    await jobs.patchJob(c.env.DB, job.id, {
      status: 'queued',
      error: null,
      finished_at: null,
      rounds: 0,
      progress: 'Reading your request',
      transcript: appendTutorRequest(job.transcript, message),
      chat: [...job.chat, { role: 'tutor', text: message, at }],
      steps: [...job.steps, { at, kind: 'info', text: `You asked: ${message.length > 120 ? `${message.slice(0, 119)}…` : message}` }],
    });
    await c.env.TUTOR_NOTES_QUEUE.send({ jobId: job.id, resume: true });
    const updated = await jobs.getJobInRelationship(c.env.DB, relId, job.id);
    return c.json({ job: jobBrief(updated!) }, 202);
  } catch (error) {
    return errorResponse(c, error, 'Failed to send the message');
  }
});

drafts.post('/relationships/:relId/homework-drafts/:jobId/assign', async (c) => {
  try {
    const relId = c.req.param('relId');
    await requireTutorOf(c.env.DB, relId, c.get('user').id);
    const job = await draftJob(c.env.DB, relId, c.req.param('jobId'));
    const body = await c.req.json<{ today?: unknown }>().catch(() => ({} as { today?: unknown }));
    const result = await assignDraft(c.env, job, todayParam(body.today));
    return c.json(result, 201);
  } catch (error) {
    return errorResponse(c, error, 'Failed to assign the draft');
  }
});

export { drafts as homeworkDraftRoutes };
