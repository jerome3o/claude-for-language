/**
 * The graded-reader queue — "Up next" on the Readers list (services/reader-queue.ts,
 * shared/reader/queue.ts; docs/STUDY_SESSION.md "Graded readers"). Mounted under /api
 * after the auth middleware and BEFORE the `/api/readers/:id` routes in index.ts.
 *
 *   GET  /readers/queue                      → { queue: [{ id, title_chinese, title_english, difficulty_level,
 *                                                 topic, folder_id, page_count, created_at, queue_priority,
 *                                                 queue_position }] }  (unread, ready stories; first = offered next)
 *   POST /readers/:id/move { to: 'top' | 'up' | 'down' | 'bottom' } or { position: n (1-based) }
 *                                            → { queue, changed, queue_position, queue_total }
 *                                              (404 not the caller's, 409 not in the queue — read / not ready)
 *   PUT  /readers/reorder { reader_ids }     → { queue, changed, ignored }  (those first, the rest after as they were)
 *
 * `source: 'mcp'` in a body marks an agent's move for analytics (the apps track their own taps).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { isQueueMove } from '@shared/decks/queue';
import type { ReaderQueueMove } from '@shared/reader/queue';
import { getReaderQueue, moveReaderInAccountQueue, reorderAccountReaderQueue, ReaderQueueError, type ReaderQueueEntry } from '../services/reader-queue';
import { trackServer } from '../services/analytics/server-events';

const readerQueue = new Hono<{ Bindings: Env }>();

const shape = (queue: ReaderQueueEntry[]) => queue.map((r, i) => ({ ...r, page_count: Number(r.page_count), queue_position: i + 1 }));

readerQueue.get('/readers/queue', async (c) => {
  const { queue } = await getReaderQueue(c.env.DB, c.get('user').id);
  return c.json({ queue: shape(queue) });
});

readerQueue.put('/readers/reorder', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json<{ reader_ids?: unknown; source?: unknown }>().catch(() => null);
  if (!body || !Array.isArray(body.reader_ids)) return c.json({ error: 'reader_ids must be an array' }, 400);
  const ids = body.reader_ids.filter((s): s is string => typeof s === 'string' && !!s);
  const result = await reorderAccountReaderQueue(c.env.DB, userId, ids);
  if (body.source === 'mcp' && result.changed) {
    void trackServer('reader.queue_move', { how: 'reorder', total: result.queue.length, via: 'mcp' }, { env: c.env, userId });
  }
  return c.json({ queue: shape(result.queue), changed: result.changed, ignored: result.ignored });
});

readerQueue.post('/readers/:id/move', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json<{ to?: unknown; position?: unknown; source?: unknown }>().catch(() => null);
  let to: ReaderQueueMove;
  if (body && isQueueMove(body.to)) to = body.to;
  else if (body && typeof body.position === 'number' && Number.isFinite(body.position) && body.position >= 1) to = Math.floor(body.position);
  else if (body && typeof body.to === 'number' && Number.isFinite(body.to) && body.to >= 1) to = Math.floor(body.to);
  else return c.json({ error: "Send to: 'top' | 'up' | 'down' | 'bottom', or position: a 1-based place" }, 400);
  try {
    const result = await moveReaderInAccountQueue(c.env.DB, userId, c.req.param('id'), to);
    if (body?.source === 'mcp' && result.changed) {
      void trackServer('reader.queue_move', {
        how: typeof to === 'number' ? 'position' : to,
        position: result.queue_position,
        total: result.queue.length,
        via: 'mcp',
      }, { env: c.env, userId });
    }
    return c.json({ queue: shape(result.queue), changed: result.changed, queue_position: result.queue_position, queue_total: result.queue.length });
  } catch (err) {
    if (err instanceof ReaderQueueError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

export default readerQueue;
