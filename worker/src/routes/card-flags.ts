/**
 * Card flags — a student flags one card for their tutor with a note.
 * Mounted under /api in index.ts after the auth middleware.
 *
 *   POST   /card-flags                              student: { id?, relationship_id, note_id, card_id?, message, created_at? }
 *   GET    /relationships/:relId/card-flags?status= either party: flags in the relationship, newest first
 *   POST   /card-flags/:id/reply                    tutor: { reply } — resolves the flag, reply shown to the student
 *   POST   /card-flags/:id/resolve | /reopen        either party
 *   DELETE /card-flags/:id                          the student who sent it
 *
 * The student's side of a reply (shown once on the card back) rides on
 * GET /me/recording-notes (routes/recording-notes.ts) with kind 'flag'.
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import {
  CardFlagError,
  createCardFlag,
  deleteCardFlag,
  listCardFlags,
  replyToCardFlag,
  setCardFlagStatus,
  type CardFlagStatus,
  type CreateCardFlagInput,
} from '../services/card-flags';

const cardFlags = new Hono<{ Bindings: Env }>();

function errorResponse(c: { json: (body: unknown, status?: number) => Response }, error: unknown, fallback: string): Response {
  if (error instanceof CardFlagError) return c.json({ error: error.message }, error.status);
  console.error('[card-flags]', error);
  return c.json({ error: fallback }, 500);
}

cardFlags.post('/card-flags', async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json<CreateCardFlagInput>();
    const { flag, created } = await createCardFlag(c.env.DB, user.id, body);
    return c.json({ flag, created }, created ? 201 : 200);
  } catch (error) {
    return errorResponse(c, error, 'Failed to flag the card');
  }
});

cardFlags.get('/relationships/:relId/card-flags', async (c) => {
  try {
    const user = c.get('user');
    const status = (c.req.query('status') || 'all') as CardFlagStatus | 'all';
    if (!['open', 'resolved', 'all'].includes(status)) return c.json({ error: 'status must be open, resolved or all' }, 400);
    const limitRaw = Number(c.req.query('limit'));
    const flags = await listCardFlags(c.env.DB, c.req.param('relId'), user.id, {
      status,
      limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
    });
    return c.json({ flags, open: flags.filter((f) => f.status === 'open').length });
  } catch (error) {
    return errorResponse(c, error, 'Failed to load the flagged cards');
  }
});

cardFlags.post('/card-flags/:id/reply', async (c) => {
  try {
    const user = c.get('user');
    const { reply } = await c.req.json<{ reply?: string }>();
    const flag = await replyToCardFlag(c.env.DB, c.req.param('id'), user.id, reply || '');
    return c.json({ flag });
  } catch (error) {
    return errorResponse(c, error, 'Failed to reply');
  }
});

cardFlags.post('/card-flags/:id/resolve', async (c) => {
  try {
    const flag = await setCardFlagStatus(c.env.DB, c.req.param('id'), c.get('user').id, 'resolved');
    return c.json({ flag });
  } catch (error) {
    return errorResponse(c, error, 'Failed to resolve the flag');
  }
});

cardFlags.post('/card-flags/:id/reopen', async (c) => {
  try {
    const flag = await setCardFlagStatus(c.env.DB, c.req.param('id'), c.get('user').id, 'open');
    return c.json({ flag });
  } catch (error) {
    return errorResponse(c, error, 'Failed to reopen the flag');
  }
});

cardFlags.delete('/card-flags/:id', async (c) => {
  try {
    await deleteCardFlag(c.env.DB, c.req.param('id'), c.get('user').id);
    return c.json({ success: true });
  } catch (error) {
    return errorResponse(c, error, 'Failed to delete the flag');
  }
});

export default cardFlags;
