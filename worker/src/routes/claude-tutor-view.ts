/**
 * What a learner's tutor can read of his chats with Claude (docs/CHAT.md "Claude threads" → "What your
 * tutor sees"; shared/claude/visibility.ts, services/claude-agent/tutor-view.ts). Mounted under /api
 * after the auth middleware.
 *
 *   PUT /profile/claude-tutor-visibility { claude_tutor_visibility: 'card_only' | 'all' | 'none' | null }
 *       → { claude_tutor_visibility } (null = back to the default, card questions; also on /api/auth/me)
 *       One chat's own choice: PATCH /api/claude/threads/:id { tutor_visible: true | false | null }.
 *   GET /relationships/:relId/claude-threads?limit=&before=&note_id=
 *       → TutorClaudeThreadsResponse — the tutor of an ACTIVE relationship only (403 for the student /
 *         anyone else, 404 for a missing or inactive relationship); only the chats he lets her read
 *   GET /relationships/:relId/claude-threads/:id → TutorClaudeThreadResponse, read-only; 404 when the
 *       chat is missing, deleted or private (the same answer, so a private chat can't be probed)
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { pickTutorVisibility } from '@shared/claude/visibility';
import { getMyRole, getOtherUserId, verifyRelationshipAccess } from '../services/relationships';
import { getTutorThread, listTutorThreads, setTutorVisibility } from '../services/claude-agent/tutor-view';

const tutorView = new Hono<{ Bindings: Env }>();

class HttpError extends Error {
  constructor(public status: 403 | 404, message: string) {
    super(message);
  }
}

function userIdOf(c: Context<{ Bindings: Env }>): string {
  return (c.get('user' as never) as { id: string }).id;
}

function fail(c: Context<{ Bindings: Env }>, error: unknown, fallback: string): Response {
  if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
  console.error('[claude-tutor-view]', error instanceof Error ? error.message : error);
  return c.json({ error: fallback }, 500);
}

/** The student's user id when the caller is the tutor of this active relationship. */
export async function studentOfTutor(db: D1Database, relId: string, userId: string): Promise<string> {
  let rel;
  try {
    rel = await verifyRelationshipAccess(db, relId, userId);
  } catch {
    throw new HttpError(404, 'Relationship not found or not active');
  }
  if (getMyRole(rel, userId) !== 'tutor') throw new HttpError(403, 'Only the tutor can view this');
  return getOtherUserId(rel, userId);
}

tutorView.put('/profile/claude-tutor-visibility', async (c) => {
  const body = await c.req.json<{ claude_tutor_visibility?: unknown }>().catch(() => ({}) as { claude_tutor_visibility?: unknown });
  const value = pickTutorVisibility(body.claude_tutor_visibility);
  if (value === undefined) return c.json({ error: "claude_tutor_visibility must be 'card_only', 'all', 'none' or null" }, 400);
  try {
    return c.json({ claude_tutor_visibility: await setTutorVisibility(c.env.DB, userIdOf(c), value) });
  } catch (error) {
    return fail(c, error, 'Could not save');
  }
});

tutorView.get('/relationships/:relId/claude-threads', async (c) => {
  try {
    const studentId = await studentOfTutor(c.env.DB, c.req.param('relId'), userIdOf(c));
    const limitRaw = Number(c.req.query('limit'));
    return c.json(
      await listTutorThreads(c.env.DB, studentId, {
        limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
        before: c.req.query('before') || null,
        noteId: c.req.query('note_id') || null,
      }),
    );
  } catch (error) {
    return fail(c, error, "Failed to load the student's Claude chats");
  }
});

tutorView.get('/relationships/:relId/claude-threads/:id', async (c) => {
  try {
    const studentId = await studentOfTutor(c.env.DB, c.req.param('relId'), userIdOf(c));
    const res = await getTutorThread(c.env.DB, studentId, c.req.param('id'));
    if (!res) return c.json({ error: 'Chat not found' }, 404);
    return c.json(res);
  } catch (error) {
    return fail(c, error, 'Failed to load the chat');
  }
});

export default tutorView;
