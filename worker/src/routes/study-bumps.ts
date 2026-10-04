/**
 * "⚡ Study it today" — the bump pocket (services/study-bumps.ts, shared/decks/bumps.ts).
 * Mounted under /api after the auth middleware.
 *
 *   GET    /me/bumps                         → { bumps: StudyBump[] }  (active: not cleared, not done)
 *   POST   /me/bumps { items?: [{ id, note_id, created_at?, source? }], note_ids?, hanzi?, source? }
 *          → { bumps, added, already, not_found }   (idempotent by note and client id; hanzi looked
 *            up in the caller's notes; 400 when nothing was given, 404 when nothing matched)
 *   DELETE /me/bumps/:noteId                 → { cleared, bumps }  (idempotent)
 *   POST   /relationships/:relId/student-bumps { note_ids?, hanzi? }
 *          → the same result for the STUDENT's notes (their tutor only; bumped_by = the tutor,
 *            the student sees "⚡ from <tutor>")
 *
 * `/api/sync/changes` carries the same active list as `bumps`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { addBumps, clearBumps, listActiveBumps, MAX_BUMPS_PER_REQUEST, type BumpInputItem } from '../services/study-bumps';
import { guardTutorOf } from './student-profile';
import { trackServer } from '../services/analytics/server-events';

/** Sources only the server sees (agents, MCP, tutor) — the apps track their own taps. */
const SERVER_SIDE_SOURCES = new Set(['mcp', 'coach_chat', 'ask_claude', 'chat_discuss', 'tutor']);

const studyBumps = new Hono<{ Bindings: Env }>();

interface BumpBody {
  items?: BumpInputItem[];
  note_ids?: string[];
  hanzi?: string[] | string;
  source?: string;
}

function parseBody(body: BumpBody | null): { items: BumpInputItem[]; noteIds: string[]; hanzi: string[]; source?: string } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Send items, note_ids or hanzi' };
  const items = Array.isArray(body.items) ? body.items.filter((i) => i && typeof i.note_id === 'string') : [];
  const noteIds = Array.isArray(body.note_ids) ? body.note_ids.filter((s): s is string => typeof s === 'string' && !!s) : [];
  const hanzi = (typeof body.hanzi === 'string' ? [body.hanzi] : Array.isArray(body.hanzi) ? body.hanzi : []).filter(
    (s): s is string => typeof s === 'string' && !!s.trim()
  );
  const n = items.length + noteIds.length + hanzi.length;
  if (n === 0) return { error: 'Send items, note_ids or hanzi' };
  if (n > MAX_BUMPS_PER_REQUEST) return { error: `At most ${MAX_BUMPS_PER_REQUEST} words at a time` };
  return { items, noteIds, hanzi, source: typeof body.source === 'string' ? body.source : undefined };
}

studyBumps.get('/me/bumps', async (c) => {
  const userId = c.get('user').id;
  return c.json({ bumps: await listActiveBumps(c.env.DB, userId) });
});

studyBumps.post('/me/bumps', async (c) => {
  const userId = c.get('user').id;
  const parsed = parseBody(await c.req.json<BumpBody>().catch(() => null));
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const result = await addBumps(c.env.DB, userId, parsed);
  if (result.added.length === 0 && result.already.length === 0) {
    return c.json({ error: 'None of those words are in your decks', ...result }, 404);
  }
  const source = parsed.items[0]?.source ?? parsed.source ?? 'other';
  if (result.added.length && SERVER_SIDE_SOURCES.has(source)) {
    void trackServer('study.bump_added', { source, count: result.added.length, already: result.already.length }, { env: c.env, userId });
  }
  return c.json(result);
});

studyBumps.delete('/me/bumps/:noteId', async (c) => {
  const userId = c.get('user').id;
  const cleared = await clearBumps(c.env.DB, userId, [c.req.param('noteId')]);
  return c.json({ cleared, bumps: await listActiveBumps(c.env.DB, userId) });
});

studyBumps.post('/relationships/:relId/student-bumps', async (c) => {
  const user = c.get('user');
  const g = await guardTutorOf(c.env.DB, c.req.param('relId'), user.id);
  if (!g.ok) return c.json({ error: g.status === 403 ? "Only the student's tutor can bump their cards" : g.error }, g.status);
  const parsed = parseBody(await c.req.json<BumpBody>().catch(() => null));
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const result = await addBumps(c.env.DB, g.studentId, { noteIds: parsed.noteIds, hanzi: parsed.hanzi, source: 'tutor', bumpedBy: user.id });
  if (result.added.length === 0 && result.already.length === 0) {
    return c.json({ error: "None of those words are in the student's decks", ...result }, 404);
  }
  void trackServer('study.bump_added', { source: 'tutor', count: result.added.length, already: result.already.length }, { env: c.env, userId: user.id });
  return c.json(result);
});

export default studyBumps;
