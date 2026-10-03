/**
 * Take homework back (services/homework-removal.ts). Mounted under /api after
 * the auth middleware; the relationship's tutor only.
 *
 *   GET    /relationships/:relId/shared-decks/:id/removal   what removing would lose (confirm sheet)
 *   DELETE /relationships/:relId/shared-decks/:id[?delete_source=1]
 *          :id = the share id or the student's copy id → { removed, words_met, reviews, … }
 *   GET    /relationships/:relId/student-lessons/:lessonId/removal
 *   DELETE /relationships/:relId/student-lessons/:lessonId   a lesson this tutor assigned (library item stays)
 *   GET    /relationships/:relId/shared-readers/:id/removal
 *   DELETE /relationships/:relId/shared-readers/:id          :id = the share id or the student's copy id
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import {
  RemovalError,
  previewDeckRemoval,
  previewLessonRemoval,
  previewReaderRemoval,
  removeStudentDeck,
  removeStudentLesson,
  removeStudentReader,
} from '../services/homework-removal';

const homeworkRemoval = new Hono<{ Bindings: Env }>();

function fail(c: { json: (body: unknown, status?: number) => Response }, error: unknown): Response {
  if (error instanceof RemovalError) return c.json({ error: error.message }, error.status);
  const message = error instanceof Error ? error.message : 'Could not remove the homework';
  console.error('[homework-removal]', message);
  return c.json({ error: message }, 500);
}

const truthy = (v: string | undefined) => v === '1' || v === 'true';

homeworkRemoval.get('/relationships/:relId/shared-decks/:id/removal', async (c) => {
  try {
    return c.json(await previewDeckRemoval(c.env.DB, c.req.param('relId'), c.get('user').id, c.req.param('id')));
  } catch (error) {
    return fail(c, error);
  }
});

homeworkRemoval.delete('/relationships/:relId/shared-decks/:id', async (c) => {
  try {
    const result = await removeStudentDeck(c.env, c.req.param('relId'), c.get('user').id, c.req.param('id'), {
      deleteSource: truthy(c.req.query('delete_source')),
      bg: c.executionCtx,
    });
    return c.json(result);
  } catch (error) {
    return fail(c, error);
  }
});

homeworkRemoval.get('/relationships/:relId/student-lessons/:lessonId/removal', async (c) => {
  try {
    return c.json(await previewLessonRemoval(c.env.DB, c.req.param('relId'), c.get('user').id, c.req.param('lessonId')));
  } catch (error) {
    return fail(c, error);
  }
});

homeworkRemoval.delete('/relationships/:relId/student-lessons/:lessonId', async (c) => {
  try {
    return c.json(await removeStudentLesson(c.env, c.req.param('relId'), c.get('user').id, c.req.param('lessonId')));
  } catch (error) {
    return fail(c, error);
  }
});

homeworkRemoval.get('/relationships/:relId/shared-readers/:id/removal', async (c) => {
  try {
    return c.json(await previewReaderRemoval(c.env.DB, c.req.param('relId'), c.get('user').id, c.req.param('id')));
  } catch (error) {
    return fail(c, error);
  }
});

homeworkRemoval.delete('/relationships/:relId/shared-readers/:id', async (c) => {
  try {
    return c.json(await removeStudentReader(c.env, c.req.param('relId'), c.get('user').id, c.req.param('id')));
  } catch (error) {
    return fail(c, error);
  }
});

export default homeworkRemoval;
