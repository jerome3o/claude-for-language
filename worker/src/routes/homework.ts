/**
 * Homework assignments (docs/HOMEWORK.md). Mounted under /api after the auth
 * middleware, so c.get('user') is always set.
 *
 * Student:
 *   GET   /me/homework                         { assignments, events } — the offline sync
 *   POST  /me/homework/events                  { events } → { accepted, assignments } (idempotent by event id)
 *
 * Tutor (the relationship's tutor only):
 *   GET   /relationships/:relId/homework       ?today=YYYY-MM-DD → { assignments, load }
 *   POST  /relationships/:relId/homework       { items, today? } → 201 { assignments, skipped, errors }
 *   PATCH /relationships/:relId/homework/:id   { due_date?, status?: 'cancelled' | 'active' }
 */

import { Hono } from 'hono';
import type { Env, TutorRelationship } from '../types';
import { isDateString, localDate, passItemIds } from '@shared/homework';
import { verifyRelationshipAccess, getMyRole, getOtherUserId } from '../services/relationships';
import * as hw from '../db/homework-queries';
import { assignHomework, parseAssignItems, recordEvents, recomputeProgress, studentLoad, HomeworkError } from '../services/homework';

const homework = new Hono<{ Bindings: Env }>();

export async function requireTutorOf(db: D1Database, relId: string, userId: string): Promise<{ rel: TutorRelationship; studentId: string }> {
  let rel: TutorRelationship;
  try {
    rel = await verifyRelationshipAccess(db, relId, userId);
  } catch {
    throw new HomeworkError(404, 'Relationship not found or not active');
  }
  if (getMyRole(rel, userId) !== 'tutor') throw new HomeworkError(403, 'Only the tutor can do this');
  return { rel, studentId: getOtherUserId(rel, userId) };
}

export function homeworkErrorResponse(c: { json: (body: unknown, status?: number) => Response }, error: unknown, fallback: string): Response {
  if (error instanceof HomeworkError) return c.json({ error: error.message }, error.status);
  const message = error instanceof Error ? error.message : fallback;
  console.error('[homework]', message);
  return c.json({ error: message }, 500);
}

/** The caller's calendar day: `today` when valid, else UTC. */
export function todayParam(raw: unknown): string {
  return isDateString(raw) ? raw : localDate(new Date(Date.now()));
}

// ============ Student ============

homework.get('/me/homework', async (c) => {
  try {
    const me = c.get('user').id;
    const assignments = await hw.listStudentAssignments(c.env.DB, me);
    const events = await hw.listEvents(c.env.DB, assignments.filter((a) => a.status === 'active').map((a) => a.id));
    return c.json({ assignments, events });
  } catch (error) {
    return homeworkErrorResponse(c, error, 'Failed to load homework');
  }
});

homework.post('/me/homework/events', async (c) => {
  try {
    const body = await c.req.json<{ events?: unknown }>().catch(() => ({} as { events?: unknown }));
    const result = await recordEvents(c.env.DB, c.get('user').id, body.events);
    return c.json(result);
  } catch (error) {
    return homeworkErrorResponse(c, error, 'Failed to record homework progress');
  }
});

// ============ Tutor ============

homework.get('/relationships/:relId/homework', async (c) => {
  try {
    const relId = c.req.param('relId');
    const { studentId } = await requireTutorOf(c.env.DB, relId, c.get('user').id);
    const today = todayParam(c.req.query('today'));
    const [assignments, load] = await Promise.all([hw.listRelationshipAssignments(c.env.DB, relId), studentLoad(c.env.DB, studentId, today)]);
    return c.json({ assignments, load, today });
  } catch (error) {
    return homeworkErrorResponse(c, error, 'Failed to load homework');
  }
});

homework.post('/relationships/:relId/homework', async (c) => {
  try {
    const relId = c.req.param('relId');
    const tutor = c.get('user');
    const { studentId } = await requireTutorOf(c.env.DB, relId, tutor.id);
    const body = await c.req.json<{ items?: unknown; today?: unknown }>().catch(() => ({} as { items?: unknown; today?: unknown }));
    const items = parseAssignItems(body.items);
    const result = await assignHomework(c.env, { relationshipId: relId, tutorId: tutor.id, studentId, items, today: todayParam(body.today) });
    if (result.assignments.length === 0 && result.errors.length > 0) return c.json({ ...result, error: result.errors[0].error }, 400);
    return c.json(result, 201);
  } catch (error) {
    return homeworkErrorResponse(c, error, 'Failed to assign homework');
  }
});

homework.patch('/relationships/:relId/homework/:id', async (c) => {
  try {
    const relId = c.req.param('relId');
    await requireTutorOf(c.env.DB, relId, c.get('user').id);
    const a = await hw.getAssignment(c.env.DB, c.req.param('id'));
    if (!a || a.relationship_id !== relId) throw new HomeworkError(404, 'Assignment not found');
    const body = await c.req.json<{ due_date?: unknown; status?: unknown }>().catch(() => ({} as { due_date?: unknown; status?: unknown }));
    const patch: { due_date?: string | null; status?: 'active' | 'cancelled' } = {};
    if (body.due_date !== undefined) {
      if (body.due_date !== null && !isDateString(body.due_date)) throw new HomeworkError(400, 'due_date must be YYYY-MM-DD');
      if (a.mode === 'fsrs') throw new HomeworkError(400, 'A long-term-only assignment has no due date');
      patch.due_date = body.due_date as string | null;
    }
    if (body.status !== undefined) {
      if (body.status !== 'cancelled' && body.status !== 'active') throw new HomeworkError(400, "status must be 'cancelled' or 'active'");
      patch.status = body.status;
    }
    await hw.patchAssignment(c.env.DB, a.id, patch);
    let updated = (await hw.getAssignment(c.env.DB, a.id))!;
    // Re-activating recomputes: it may already be complete.
    if (patch.status === 'active') [updated] = await recomputeProgress(c.env.DB, [updated]);
    return c.json({ assignment: updated, item_ids: passItemIds(updated) });
  } catch (error) {
    return homeworkErrorResponse(c, error, 'Failed to update the assignment');
  }
});

export { homework as homeworkRoutes };
