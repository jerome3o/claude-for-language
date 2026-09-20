/**
 * Tutor → student sharing of graded readers. Mounted under /api in index.ts
 * after the auth middleware, so c.get('user') is always set here.
 *
 *   POST /relationships/:relId/share-reader     { reader_id }  → 201 { share, reader }
 *   GET  /relationships/:relId/shared-readers   readers shared in this connection + read status
 *
 * The student's copy appears in their readers list on the next sync; there is
 * no tutor UI yet — the MCP `share_reader_with_student` tool is the interface.
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { shareReader, listSharedReaders } from '../services/shared-readers';

const sharedReaders = new Hono<{ Bindings: Env }>();

function statusFor(message: string): 400 | 403 | 404 | 409 {
  if (message.startsWith('Relationship not found') || message === 'Reader not found') return 404;
  if (message.startsWith('Only tutors')) return 403;
  if (message.startsWith('Only a finished reader')) return 409;
  return 400;
}

sharedReaders.post('/relationships/:relId/share-reader', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ reader_id?: unknown }>().catch(() => ({} as { reader_id?: unknown }));
  const readerId = typeof body.reader_id === 'string' ? body.reader_id.trim() : '';
  if (!readerId) return c.json({ error: 'reader_id is required' }, 400);
  try {
    const result = await shareReader(c.env.DB, c.req.param('relId'), user.id, readerId);
    return c.json(result, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to share reader';
    const status = statusFor(message);
    if (status === 400) console.error('[shared-readers]', message);
    return c.json({ error: message }, status);
  }
});

sharedReaders.get('/relationships/:relId/shared-readers', async (c) => {
  const user = c.get('user');
  try {
    const shares = await listSharedReaders(c.env.DB, c.req.param('relId'), user.id);
    return c.json(shares);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list shared readers';
    return c.json({ error: message }, statusFor(message));
  }
});

export default sharedReaders;
