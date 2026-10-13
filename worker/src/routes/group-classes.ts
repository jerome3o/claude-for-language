/**
 * Group classes — EXPERIMENTAL web-only prototype (docs/GROUP_CLASSES.md).
 * Mounted under /api after the auth middleware, except the WebSocket and the
 * pagehide beacon (mountGroupSocket, registered before it — a join ticket /
 * the room's leave token is their credential). `GROUP_CLASSES=off` turns every
 * route into a 404.
 *
 *   GET    /groups                           { teaching, member_of } — my groups (as tutor / as student)
 *   GET    /groups/candidates                { students } — my active students
 *   POST   /groups                           { name, student_ids } → 201 { group }
 *   PATCH  /groups/:id                       { name?, student_ids? } → { group }
 *   DELETE /groups/:id                       archive (ends a live class)
 *   POST   /groups/:id/sessions              start the class (or the live one) → { session, reused }
 *   GET    /group-sessions/:id               { session, group, role }
 *   POST   /group-sessions/:id/notify        the tutor sends each student the link in their 1:1 chat → { sent }
 *   POST   /group-sessions/:id/join          → { ticket, ws_path, ice_servers, turn }
 *   POST   /group-sessions/:id/end           the tutor ends it for everyone
 *   GET    /group-sessions/:id/ws?ticket=    WebSocket into the GroupRoom
 *   POST   /group-sessions/:id/leave         { client_id, token } — pagehide beacon
 */

import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { sanitizeInstance } from '@shared/calls';
import {
  GroupError,
  archiveGroup,
  createGroup,
  getSession,
  groupInviteMessage,
  listCandidateStudents,
  listGroups,
  markSessionEnded,
  requireOwnGroup,
  requireSessionAccess,
  startSession,
  updateGroup,
  type GroupSession,
} from '../services/group-classes';
import { createJoinTicket, verifyJoinTicket } from '../services/calls/ticket';
import { getIceServers } from '../services/calls/ice';
import { openRelationshipConversation, sendMessage } from '../services/conversations';
import { resolveFrontendUrl } from '../services/auth';

const groups = new Hono<{ Bindings: Env }>();

const ticketScope = (sessionId: string) => `group:${sessionId}`;
const enabled = (env: Env) => env.GROUP_CLASSES !== 'off';

function fail(c: Context, error: unknown, fallback: string): Response {
  if (error instanceof GroupError) return c.json({ error: error.message, ...(error.problems ? { problems: error.problems } : {}) }, error.status);
  console.error('[group-classes]', error);
  return c.json({ error: fallback }, 500);
}

groups.use('/groups/*', async (c, next) => (enabled(c.env) ? next() : c.json({ error: 'Not found' }, 404)));
groups.use('/groups', async (c, next) => (enabled(c.env) ? next() : c.json({ error: 'Not found' }, 404)));
groups.use('/group-sessions/*', async (c, next) => (enabled(c.env) ? next() : c.json({ error: 'Not found' }, 404)));

function room(env: Env, sessionId: string) {
  if (!env.GROUP_ROOM) throw new GroupError('Group classes are not set up on this server', 503);
  return env.GROUP_ROOM.get(env.GROUP_ROOM.idFromName(sessionId));
}

/** A session D1 still calls live but whose room has ended (a failed write): close it in D1 too. */
async function stillLive(env: Env, session: GroupSession): Promise<boolean> {
  if (session.status !== 'live' || !env.GROUP_ROOM) return session.status === 'live';
  try {
    const p = await room(env, session.id).presence();
    if (p.ended) {
      await markSessionEnded(env.DB, session.id, Date.now(), 0);
      return false;
    }
  } catch (err) {
    console.error('[group-classes] presence check failed:', err);
  }
  return true;
}

groups.get('/groups', async (c) => {
  try {
    return c.json(await listGroups(c.env.DB, c.get('user').id));
  } catch (error) {
    return fail(c, error, 'Could not load your groups');
  }
});

groups.get('/groups/candidates', async (c) => {
  try {
    return c.json({ students: await listCandidateStudents(c.env.DB, c.get('user').id) });
  } catch (error) {
    return fail(c, error, 'Could not load your students');
  }
});

groups.post('/groups', async (c) => {
  try {
    const body = await c.req.json<{ name?: unknown; student_ids?: unknown }>().catch(() => ({}));
    return c.json({ group: await createGroup(c.env.DB, c.get('user').id, body) }, 201);
  } catch (error) {
    return fail(c, error, 'Could not create the group');
  }
});

groups.patch('/groups/:id', async (c) => {
  try {
    const body = await c.req.json<{ name?: unknown; student_ids?: unknown }>().catch(() => ({}));
    return c.json({ group: await updateGroup(c.env.DB, c.req.param('id'), c.get('user').id, body) });
  } catch (error) {
    return fail(c, error, 'Could not update the group');
  }
});

groups.delete('/groups/:id', async (c) => {
  try {
    const live = await archiveGroup(c.env.DB, c.req.param('id'), c.get('user').id);
    if (live && c.env.GROUP_ROOM) await room(c.env, live.id).endClass(null).catch(() => {});
    if (live) await markSessionEnded(c.env.DB, live.id, Date.now(), 0);
    return c.json({ archived: true });
  } catch (error) {
    return fail(c, error, 'Could not delete the group');
  }
});

groups.post('/groups/:id/sessions', async (c) => {
  try {
    const user = c.get('user');
    const groupId = c.req.param('id');
    const group = await requireOwnGroup(c.env.DB, groupId, user.id);
    // A "live" session whose room already ended is closed here, so a fresh one starts below.
    if (group.live_session) await stillLive(c.env, group.live_session);
    const started = await startSession(c.env.DB, groupId, user.id);
    if (!started.reused && c.env.GROUP_ROOM) {
      // Arms the "nobody came" deadline, so an unjoined class doesn't stay live for ever.
      await room(c.env, started.session.id).arm(started.session.id, user.id, started.session.created_at).catch((err) => console.error('[group-classes] arm failed:', err));
    }
    return c.json({ session: started.session, reused: started.reused }, started.reused ? 200 : 201);
  } catch (error) {
    return fail(c, error, 'Could not start the class');
  }
});

groups.get('/group-sessions/:id', async (c) => {
  try {
    const { session, group, role } = await requireSessionAccess(c.env.DB, c.req.param('id'), c.get('user').id);
    const live = await stillLive(c.env, session);
    return c.json({ session: live ? session : { ...session, status: 'ended' as const }, group, role });
  } catch (error) {
    return fail(c, error, 'Could not load the class');
  }
});

groups.post('/group-sessions/:id/notify', async (c) => {
  try {
    const user = c.get('user');
    const { session, group, role } = await requireSessionAccess(c.env.DB, c.req.param('id'), user.id);
    if (role !== 'tutor') throw new GroupError('Only the tutor can send the link', 403);
    if (session.status !== 'live') throw new GroupError('This class has ended', 409);
    const url = `${resolveFrontendUrl(c.req.raw)}/group-class/${session.id}`;
    const text = groupInviteMessage(group.name, url);
    let sent = 0;
    const failed: string[] = [];
    for (const m of group.members) {
      try {
        const conv = (await openRelationshipConversation(c.env.DB, m.relationship_id, user.id)).conversation;
        // client_id: sending twice for the same class doesn't post twice.
        await sendMessage(c.env.DB, conv.id, user.id, text, undefined, { clientId: `group-${session.id}-${m.user_id}`.slice(0, 64) });
        sent++;
      } catch (err) {
        console.error('[group-classes] notify failed for a member:', err);
        failed.push(m.user_id);
      }
    }
    return c.json({ sent, failed });
  } catch (error) {
    return fail(c, error, 'Could not send the link');
  }
});

groups.post('/group-sessions/:id/join', async (c) => {
  try {
    const user = c.get('user');
    const { session } = await requireSessionAccess(c.env.DB, c.req.param('id'), user.id);
    if (session.status !== 'live') throw new GroupError('This class has ended', 409);
    room(c.env, session.id); // 503 when the binding is missing
    const [ticket, ice] = await Promise.all([createJoinTicket(c.env, ticketScope(session.id), user.id), getIceServers(c.env)]);
    return c.json({ ticket, ws_path: `/api/group-sessions/${session.id}/ws`, ice_servers: ice.iceServers, turn: ice.turn });
  } catch (error) {
    return fail(c, error, 'Could not join the class');
  }
});

groups.post('/group-sessions/:id/end', async (c) => {
  try {
    const user = c.get('user');
    const { session, role } = await requireSessionAccess(c.env.DB, c.req.param('id'), user.id);
    if (role !== 'tutor') throw new GroupError('Only the tutor can end the class', 403);
    if (c.env.GROUP_ROOM) await room(c.env, session.id).endClass(user.name || null).catch((err) => console.error('[group-classes] end failed:', err));
    await markSessionEnded(c.env.DB, session.id, Date.now(), 0);
    return c.json({ ended: true });
  } catch (error) {
    return fail(c, error, 'Could not end the class');
  }
});

export default groups;

/** The WebSocket + the pagehide beacon — registered BEFORE the auth middleware. */
export function mountGroupSocket(app: Hono<{ Bindings: Env }>): void {
  app.post('/api/group-sessions/:id/leave', async (c) => {
    try {
      if (!c.env.GROUP_ROOM || !enabled(c.env)) return c.body(null, 204);
      const rawBody = await c.req.text();
      if (rawBody.length > 1000) return c.body(null, 204);
      const body = JSON.parse(rawBody || '{}') as { client_id?: unknown; token?: unknown };
      const sessionId = c.req.param('id');
      if (typeof body.client_id !== 'string' || typeof body.token !== 'string' || !/^[\w-]{1,64}$/.test(sessionId)) return c.body(null, 204);
      await room(c.env, sessionId).leave(body.client_id.slice(0, 64), body.token.slice(0, 64));
    } catch (err) {
      console.error('[group-classes] leave beacon failed:', err);
    }
    return c.body(null, 204);
  });

  app.get('/api/group-sessions/:id/ws', async (c) => {
    if (c.req.header('Upgrade') !== 'websocket') return c.json({ error: 'Expected a WebSocket' }, 426);
    if (!enabled(c.env)) return c.json({ error: 'Not found' }, 404);
    if (!c.env.GROUP_ROOM) return c.json({ error: 'Group classes are not set up on this server' }, 503);
    const sessionId = c.req.param('id');
    const claims = await verifyJoinTicket(c.env, c.req.query('ticket'), ticketScope(sessionId));
    if (!claims) return c.json({ error: 'Unauthorized' }, 401);
    try {
      // Membership is checked again here (the ticket is a minute old at most, but a relationship can end).
      const { session } = await requireSessionAccess(c.env.DB, sessionId, claims.userId);
      if (session.status !== 'live') return c.json({ error: 'This class has ended' }, 410);
      const user = await c.env.DB
        .prepare('SELECT id, name, email, picture_url FROM users WHERE id = ?')
        .bind(claims.userId)
        .first<{ id: string; name: string | null; email: string; picture_url: string | null }>();
      if (!user) return c.json({ error: 'Unauthorized' }, 401);
      const headers = new Headers(c.req.raw.headers);
      headers.set('X-Session-Id', session.id);
      headers.set('X-Tutor-Id', session.tutor_id);
      headers.set('X-Created-At', String(session.created_at));
      headers.set('X-User-Id', user.id);
      headers.set('X-User-Name', encodeURIComponent(user.name || user.email.split('@')[0]));
      if (user.picture_url) headers.set('X-User-Picture', user.picture_url);
      const instance = sanitizeInstance(c.req.query('instance'));
      if (instance) headers.set('X-Instance', instance);
      const res = await room(c.env, session.id).fetch(new Request(c.req.raw.url, { headers }));
      if (res.status === 410) await markSessionEnded(c.env.DB, session.id, Date.now(), 0);
      return res;
    } catch (error) {
      return fail(c, error, 'Could not join the class');
    }
  });
}
