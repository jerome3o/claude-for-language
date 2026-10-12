/**
 * "Up next" — the account's ordered list of chosen notes (services/up-next.ts,
 * shared/decks/up-next.ts). Mounted under /api after the auth middleware.
 *
 *   GET    /me/up-next                         → { up_next: UpNextEntry[] }  (active, list order)
 *   POST   /me/up-next { items?: [{ id, note_id, created_at? }], note_ids?, hanzi?, position?, source? }
 *          → { up_next, added, already, moved, no_new_cards, not_found, over_limit }
 *            (position 'top' | 'bottom' | 0-based index, default bottom; a note already on the list
 *            moves there when a position is given; idempotent by note and client id; 400 when nothing
 *            was given, 404 when nothing matched)
 *   PUT    /me/up-next/order { note_ids }       → { up_next }  (those first in that order, the rest after)
 *   DELETE /me/up-next/:noteId                  → { removed, up_next }  (idempotent; the note is kept)
 *
 * The tutor of an active relationship does the same on the STUDENT's list (added_by = the
 * tutor, the student sees "added by <tutor>"):
 *   GET|POST /relationships/:relId/student-up-next, PUT …/student-up-next/order,
 *   DELETE …/student-up-next/:noteId
 *   GET /relationships/:relId/student-notes/search?q=&limit=  → { notes: [{ id, hanzi, pinyin, english,
 *       deck_id, deck_name, new_cards, total_cards, on_up_next }] }  (the tutor's search of the student's
 *       notes, to pick words for their list)
 *
 * `/api/sync/changes` carries the same active list as `up_next`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { MAX_UP_NEXT_PER_REQUEST, addUpNext, cardCounts, listUpNext, removeUpNext, reorderUpNextRows, type UpNextInputItem } from '../services/up-next';
import { searchUserNotes } from './note-search';
import { guardTutorOf } from './student-profile';
import { trackServer } from '../services/analytics/server-events';

/** Sources only the server sees (agents, tutor) — the apps track their own taps. */
const SERVER_SIDE_SOURCES = new Set(['mcp', 'tutor']);

const upNext = new Hono<{ Bindings: Env }>();

interface AddBody {
  items?: UpNextInputItem[];
  note_ids?: string[];
  hanzi?: string[] | string;
  position?: unknown;
  source?: string;
}

function parseAdd(body: AddBody | null): { items: UpNextInputItem[]; noteIds: string[]; hanzi: string[]; position?: unknown; source?: string } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Send items, note_ids or hanzi' };
  const items = Array.isArray(body.items) ? body.items.filter((i) => i && typeof i.note_id === 'string') : [];
  const noteIds = Array.isArray(body.note_ids) ? body.note_ids.filter((s): s is string => typeof s === 'string' && !!s) : [];
  const hanzi = (typeof body.hanzi === 'string' ? [body.hanzi] : Array.isArray(body.hanzi) ? body.hanzi : []).filter(
    (s): s is string => typeof s === 'string' && !!s.trim()
  );
  const n = items.length + noteIds.length + hanzi.length;
  if (n === 0) return { error: 'Send items, note_ids or hanzi' };
  if (n > MAX_UP_NEXT_PER_REQUEST) return { error: `At most ${MAX_UP_NEXT_PER_REQUEST} words at a time` };
  return { items, noteIds, hanzi, position: body.position, source: typeof body.source === 'string' ? body.source : undefined };
}

function parseOrder(body: { note_ids?: unknown } | null): string[] | null {
  if (!body || !Array.isArray(body.note_ids)) return null;
  return body.note_ids.filter((s): s is string => typeof s === 'string' && !!s);
}

upNext.get('/me/up-next', async (c) => {
  return c.json({ up_next: await listUpNext(c.env.DB, c.get('user').id) });
});

upNext.post('/me/up-next', async (c) => {
  const userId = c.get('user').id;
  const parsed = parseAdd(await c.req.json<AddBody>().catch(() => null));
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const result = await addUpNext(c.env.DB, userId, parsed);
  if (!result.added.length && !result.already.length && !result.moved.length && !result.no_new_cards.length) {
    return c.json({ error: 'None of those words are in your decks', ...result }, 404);
  }
  const source = parsed.source ?? 'other';
  if (result.added.length && SERVER_SIDE_SOURCES.has(source)) {
    void trackServer('study.up_next_added', { source, count: result.added.length, already: result.already.length }, { env: c.env, userId });
  }
  return c.json(result);
});

upNext.put('/me/up-next/order', async (c) => {
  const ids = parseOrder(await c.req.json<{ note_ids?: unknown }>().catch(() => null));
  if (!ids) return c.json({ error: 'Send note_ids in the new order' }, 400);
  return c.json({ up_next: await reorderUpNextRows(c.env.DB, c.get('user').id, ids) });
});

upNext.delete('/me/up-next/:noteId', async (c) => {
  const userId = c.get('user').id;
  const removed = await removeUpNext(c.env.DB, userId, [c.req.param('noteId')]);
  return c.json({ removed, up_next: await listUpNext(c.env.DB, userId) });
});

// ---- the tutor, on the student's list ----

async function tutorGuard(db: D1Database, relId: string, userId: string) {
  const g = await guardTutorOf(db, relId, userId);
  if (!g.ok) return { ok: false as const, status: g.status, error: g.status === 403 ? "Only the student's tutor can change their Up next list" : g.error };
  return g;
}

upNext.get('/relationships/:relId/student-up-next', async (c) => {
  const g = await tutorGuard(c.env.DB, c.req.param('relId'), c.get('user').id);
  if (!g.ok) return c.json({ error: g.error }, g.status);
  return c.json({ up_next: await listUpNext(c.env.DB, g.studentId) });
});

upNext.post('/relationships/:relId/student-up-next', async (c) => {
  const user = c.get('user');
  const g = await tutorGuard(c.env.DB, c.req.param('relId'), user.id);
  if (!g.ok) return c.json({ error: g.error }, g.status);
  const parsed = parseAdd(await c.req.json<AddBody>().catch(() => null));
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const result = await addUpNext(c.env.DB, g.studentId, { ...parsed, source: 'tutor', addedBy: user.id });
  if (!result.added.length && !result.already.length && !result.moved.length && !result.no_new_cards.length) {
    return c.json({ error: "None of those words are in the student's decks", ...result }, 404);
  }
  if (result.added.length) {
    void trackServer('study.up_next_added', { source: 'tutor', count: result.added.length, already: result.already.length }, { env: c.env, userId: user.id });
  }
  return c.json(result);
});

upNext.put('/relationships/:relId/student-up-next/order', async (c) => {
  const g = await tutorGuard(c.env.DB, c.req.param('relId'), c.get('user').id);
  if (!g.ok) return c.json({ error: g.error }, g.status);
  const ids = parseOrder(await c.req.json<{ note_ids?: unknown }>().catch(() => null));
  if (!ids) return c.json({ error: 'Send note_ids in the new order' }, 400);
  return c.json({ up_next: await reorderUpNextRows(c.env.DB, g.studentId, ids) });
});

upNext.delete('/relationships/:relId/student-up-next/:noteId', async (c) => {
  const g = await tutorGuard(c.env.DB, c.req.param('relId'), c.get('user').id);
  if (!g.ok) return c.json({ error: g.error }, g.status);
  const removed = await removeUpNext(c.env.DB, g.studentId, [c.req.param('noteId')]);
  return c.json({ removed, up_next: await listUpNext(c.env.DB, g.studentId) });
});

upNext.get('/relationships/:relId/student-notes/search', async (c) => {
  const g = await tutorGuard(c.env.DB, c.req.param('relId'), c.get('user').id);
  if (!g.ok) return c.json({ error: g.error }, g.status);
  const q = (c.req.query('q') || '').trim();
  if (!q) return c.json({ notes: [] });
  const limitRaw = Number(c.req.query('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 20;
  const { notes } = await searchUserNotes(c.env.DB, g.studentId, q, limit);
  const counts = await cardCounts(c.env.DB, g.studentId, notes.map((n) => n.id));
  const listed = new Set((await listUpNext(c.env.DB, g.studentId)).map((e) => e.note_id));
  return c.json({
    notes: notes.map((n) => ({
      id: n.id,
      hanzi: n.hanzi,
      pinyin: n.pinyin,
      english: n.english,
      deck_id: n.deck_id,
      deck_name: n.deck_name,
      new_cards: counts.get(n.id)?.fresh ?? 0,
      total_cards: counts.get(n.id)?.total ?? 0,
      on_up_next: listed.has(n.id),
    })),
  });
});

export default upNext;
