/**
 * Board pages outside a call (read-only; shared/calls/pages.ts, services/calls/pages.ts).
 * Pages are written in calls only — the call room merges both people's typing — so
 * these routes read. Mounted under /api after the auth middleware.
 *
 *   GET /relationships/:relId/board-pages   either person of an ACTIVE relationship → { pages }
 *   GET /me/board-pages                     every page I can see (the device's offline cache) → { pages }
 *   GET /calls/:id/board-pages              the pages the call's LESSON wrote on, with the text each held when its last call ended → { pages }
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { verifyRelationshipAccess } from '../services/relationships';
import { listCallPages, listMyPages, listRelationshipPages } from '../services/calls/pages';
import { CallError, requireCall } from '../services/calls/store';
import { lessonMaterial } from '../services/calls/lessons';

const boardPages = new Hono<{ Bindings: Env }>();

boardPages.get('/relationships/:relId/board-pages', async (c) => {
  const user = c.get('user');
  const relId = c.req.param('relId');
  try {
    await verifyRelationshipAccess(c.env.DB, relId, user.id);
  } catch {
    return c.json({ error: 'Relationship not found' }, 404);
  }
  try {
    return c.json({ pages: await listRelationshipPages(c.env.DB, relId) });
  } catch (error) {
    console.error('[board-pages]', error);
    return c.json({ error: 'Failed to load the board' }, 500);
  }
});

boardPages.get('/me/board-pages', async (c) => {
  try {
    return c.json({ pages: await listMyPages(c.env.DB, c.get('user').id) });
  } catch (error) {
    console.error('[board-pages]', error);
    return c.json({ error: 'Failed to load the board' }, 500);
  }
});

boardPages.get('/calls/:id/board-pages', async (c) => {
  try {
    const user = c.get('user');
    const call = await requireCall(c.env.DB, c.req.param('id'), user.id);
    // The whole lesson's pages (each with the text the lesson's last call left it with).
    if (call.lesson_id) {
      const m = await lessonMaterial(c.env.DB, call.lesson_id);
      if (m) return c.json({ pages: m.pages });
    }
    return c.json({ pages: await listCallPages(c.env.DB, call.id, call.relationship_id, call.created_by) });
  } catch (error) {
    if (error instanceof CallError) return c.json({ error: error.message }, error.status);
    console.error('[board-pages]', error);
    return c.json({ error: 'Failed to load the board' }, 500);
  }
});

export default boardPages;
