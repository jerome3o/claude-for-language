/**
 * The homework library, link homework and "update the students' copies"
 * (docs/HOMEWORK.md §8–10). Mounted under /api after the auth middleware.
 *
 *   GET    /homework-links                              the tutor's links (+ sent_count)
 *   POST   /homework-links                              { title, url, instructions? } → 201 { link } (nothing is sent)
 *   PUT    /homework-links/:id                          any subset + update_student_copies?: boolean | relationship ids
 *   DELETE /homework-links/:id                          soft delete (sent homework keeps its snapshot)
 *   GET    /relationships/:relId/homework-library       ?today= → { items, counts, today } (tutor)
 *   GET    /tutor/homework-library                      ?today= → { students, items, counts, today }
 *   GET    /student-copies?kind=&source_id=             { copies } — where one of my things was sent
 *   POST   /student-copies/update                       { kind, source_id, relationship_ids? } → { updated, results }
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { libraryCounts, pickLinkHomework, type CleanLinkHomework } from '@shared/homework';
import * as links from '../db/homework-links-queries';
import { HomeworkError } from '../services/homework';
import { isCopyKind, listStudentCopies, relationshipLibrary, tutorLibrary, updateStudentCopies } from '../services/homework-library';
import { homeworkErrorResponse, requireTutorOf, todayParam } from './homework';

const library = new Hono<{ Bindings: Env }>();

/** `true` = every copy, an array = those relationships, anything else = none. */
function copiesParam(raw: unknown): string[] | null | false {
  if (raw === true) return null;
  if (Array.isArray(raw)) return raw.filter((r): r is string => typeof r === 'string');
  return false;
}

// ============ Links ============

library.get('/homework-links', async (c) => {
  try {
    return c.json({ links: await links.listLinks(c.env.DB, c.get('user').id) });
  } catch (error) {
    return homeworkErrorResponse(c, error, 'Failed to load links');
  }
});

library.post('/homework-links', async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const { value, problems } = pickLinkHomework(body);
    if (problems.length > 0) return c.json({ error: problems[0], problems }, 400);
    const link = await links.insertLink(c.env.DB, c.get('user').id, value as CleanLinkHomework);
    return c.json({ link }, 201);
  } catch (error) {
    return homeworkErrorResponse(c, error, 'Failed to save the link');
  }
});

library.put('/homework-links/:id', async (c) => {
  try {
    const userId = c.get('user').id;
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const { value, problems } = pickLinkHomework(body, true);
    if (problems.length > 0) return c.json({ error: problems[0], problems }, 400);
    const link = await links.updateLink(c.env.DB, c.req.param('id'), userId, value);
    if (!link) throw new HomeworkError(404, 'Link not found');
    const which = copiesParam(body.update_student_copies);
    const copies = which === false ? null : await updateStudentCopies(c.env, userId, 'link', link.id, which);
    return c.json({ link, copies });
  } catch (error) {
    return homeworkErrorResponse(c, error, 'Failed to update the link');
  }
});

library.delete('/homework-links/:id', async (c) => {
  try {
    const ok = await links.softDeleteLink(c.env.DB, c.req.param('id'), c.get('user').id);
    if (!ok) throw new HomeworkError(404, 'Link not found');
    return c.json({ deleted: true });
  } catch (error) {
    return homeworkErrorResponse(c, error, 'Failed to delete the link');
  }
});

// ============ Library ============

library.get('/relationships/:relId/homework-library', async (c) => {
  try {
    const relId = c.req.param('relId');
    const tutorId = c.get('user').id;
    const { rel, studentId } = await requireTutorOf(c.env.DB, relId, tutorId);
    const name = await c.env.DB.prepare('SELECT name, email FROM users WHERE id = ?').bind(studentId).first<{ name: string | null; email: string }>();
    const today = todayParam(c.req.query('today'));
    const items = await relationshipLibrary(c.env.DB, tutorId, { relationship_id: rel.id, student_id: studentId, student_name: name?.name || name?.email || 'Student' }, today);
    return c.json({ items, counts: libraryCounts(items), today });
  } catch (error) {
    return homeworkErrorResponse(c, error, 'Failed to load the homework library');
  }
});

library.get('/tutor/homework-library', async (c) => {
  try {
    const today = todayParam(c.req.query('today'));
    const { students, items } = await tutorLibrary(c.env.DB, c.get('user').id, today);
    return c.json({ students, items, counts: libraryCounts(items), today });
  } catch (error) {
    return homeworkErrorResponse(c, error, 'Failed to load the homework library');
  }
});

// ============ Students' copies ============

library.get('/student-copies', async (c) => {
  try {
    const kind = c.req.query('kind');
    const sourceId = c.req.query('source_id');
    if (!isCopyKind(kind)) throw new HomeworkError(400, 'kind must be deck, lesson, reader or link');
    if (!sourceId) throw new HomeworkError(400, 'source_id is required');
    return c.json({ copies: await listStudentCopies(c.env.DB, c.get('user').id, kind, sourceId) });
  } catch (error) {
    return homeworkErrorResponse(c, error, 'Failed to list the copies');
  }
});

library.post('/student-copies/update', async (c) => {
  try {
    const body = await c.req.json<{ kind?: unknown; source_id?: unknown; relationship_ids?: unknown }>().catch(() => ({} as Record<string, unknown>));
    if (!isCopyKind(body.kind)) throw new HomeworkError(400, 'kind must be deck, lesson, reader or link');
    if (typeof body.source_id !== 'string' || !body.source_id) throw new HomeworkError(400, 'source_id is required');
    const only = Array.isArray(body.relationship_ids) ? body.relationship_ids.filter((r): r is string => typeof r === 'string') : null;
    return c.json(await updateStudentCopies(c.env, c.get('user').id, body.kind, body.source_id, only));
  } catch (error) {
    return homeworkErrorResponse(c, error, 'Failed to update the copies');
  }
});

export { library as homeworkLibraryRoutes };
