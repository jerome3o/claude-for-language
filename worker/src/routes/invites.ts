import { Hono } from 'hono';
import { Env, RelationshipRole } from '../types';
import { adminMiddleware } from '../middleware/auth';
import { resolveFrontendUrl } from '../services/auth';
import { redeemInvite } from '../services/signup';
import {
  InviteWithMeta,
  MAX_INVITE_EXPIRY_DAYS,
  MAX_INVITE_USES,
  createInvite,
  getInviteById,
  inviteStatus,
  isInviteValid,
  isPlausibleInviteToken,
  listAllInvites,
  listInvitesByUser,
  revokeInvite,
  userMayInvite,
  listAccessRequests,
  getAccessRequestById,
  setAccessRequestStatus,
  setUserCanInvite,
  normalizeEmail,
} from '../db/invite-queries';

/**
 * Invite-only sign-up routes. Mounted at /api after the auth middleware;
 * GET /api/invites/:id/public is exempted there so the /join page can read it
 * before the visitor has signed in.
 */
const invites = new Hono<{ Bindings: Env }>();

function withUrl(invite: InviteWithMeta, frontendUrl: string) {
  return { ...invite, url: `${frontendUrl}/join/${invite.id}` };
}

// ---------- Public: what the /join page needs, and nothing more ----------

invites.get('/invites/:id/public', async (c) => {
  const id = c.req.param('id');
  if (!isPlausibleInviteToken(id)) {
    return c.json({ error: 'Invite not found' }, 404);
  }
  const invite = await getInviteById(c.env.DB, id);
  if (!invite) {
    return c.json({ error: 'Invite not found' }, 404);
  }
  const inviter = await c.env.DB
    .prepare('SELECT name, picture_url FROM users WHERE id = ?')
    .bind(invite.created_by)
    .first<{ name: string | null; picture_url: string | null }>();

  // Deliberately no email (bound or inviter's) and no note.
  return c.json({
    status: inviteStatus(invite),
    valid: isInviteValid(invite),
    inviter_name: inviter?.name || 'Your tutor',
    inviter_picture_url: inviter?.picture_url || null,
    inviter_role: invite.inviter_role,
    email_bound: !!invite.email,
    shares_decks: !!invite.share_deck_ids,
  });
});

// ---------- Mine ----------

invites.get('/invites', async (c) => {
  const user = c.get('user');
  const frontendUrl = resolveFrontendUrl(c.req.raw);
  const all = c.req.query('all') === '1' && !!user.is_admin;
  const rows = all ? await listAllInvites(c.env.DB) : await listInvitesByUser(c.env.DB, user.id);
  return c.json(rows.map(r => withUrl(r, frontendUrl)));
});

interface CreateInviteBody {
  email?: string | null;
  inviter_role?: RelationshipRole | null;
  share_deck_ids?: string[] | null;
  max_uses?: number | null;
  expires_in_days?: number | null;
  note?: string | null;
}

invites.post('/invites', async (c) => {
  const user = c.get('user');
  if (!userMayInvite(user)) {
    return c.json({ error: 'Only approved inviters can invite new people — ask the admin to enable this for you.' }, 403);
  }

  let body: CreateInviteBody;
  try {
    body = await c.req.json<CreateInviteBody>();
  } catch {
    body = {};
  }

  const email = body.email ? normalizeEmail(String(body.email)) : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: 'That does not look like an email address' }, 400);
  }
  const role = body.inviter_role ?? null;
  if (role !== null && role !== 'tutor' && role !== 'student') {
    return c.json({ error: 'inviter_role must be "tutor", "student" or null' }, 400);
  }
  if (body.max_uses != null && (!Number.isFinite(body.max_uses) || body.max_uses < 1 || body.max_uses > MAX_INVITE_USES)) {
    return c.json({ error: `max_uses must be between 1 and ${MAX_INVITE_USES}` }, 400);
  }
  if (body.expires_in_days != null && (!Number.isFinite(body.expires_in_days) || body.expires_in_days < 1 || body.expires_in_days > MAX_INVITE_EXPIRY_DAYS)) {
    return c.json({ error: `expires_in_days must be between 1 and ${MAX_INVITE_EXPIRY_DAYS}` }, 400);
  }

  let shareDeckIds: string[] = [];
  if (Array.isArray(body.share_deck_ids) && body.share_deck_ids.length > 0) {
    if (role !== 'tutor') {
      return c.json({ error: 'Decks can only be shared when you invite someone as their tutor' }, 400);
    }
    const ids = body.share_deck_ids.filter((x): x is string => typeof x === 'string');
    const placeholders = ids.map(() => '?').join(',');
    const owned = await c.env.DB
      .prepare(`SELECT id FROM decks WHERE user_id = ? AND id IN (${placeholders})`)
      .bind(user.id, ...ids)
      .all<{ id: string }>();
    const ownedIds = new Set(owned.results.map(r => r.id));
    const missing = ids.filter(id => !ownedIds.has(id));
    if (missing.length > 0) {
      return c.json({ error: 'You can only share your own decks' }, 400);
    }
    shareDeckIds = ids;
  }

  const invite = await createInvite(c.env.DB, {
    created_by: user.id,
    email,
    inviter_role: role,
    share_deck_ids: shareDeckIds,
    max_uses: body.max_uses ?? 1,
    expires_in_days: body.expires_in_days ?? null,
    note: body.note ? String(body.note).slice(0, 200) : null,
  });

  const frontendUrl = resolveFrontendUrl(c.req.raw);
  return c.json(withUrl({
    ...invite,
    status: inviteStatus(invite),
    creator_name: user.name,
    creator_email: user.email,
    redemptions: [],
  }, frontendUrl), 201);
});

invites.delete('/invites/:id', async (c) => {
  const user = c.get('user');
  const invite = await getInviteById(c.env.DB, c.req.param('id'));
  if (!invite) return c.json({ error: 'Invite not found' }, 404);
  if (invite.created_by !== user.id && !user.is_admin) {
    return c.json({ error: 'Not authorized to revoke this invite' }, 403);
  }
  await revokeInvite(c.env.DB, invite.id);
  return c.json({ success: true });
});

/**
 * A signed-in user opened /join/<token>: apply the invite to their existing
 * account (relationship + decks) without going through Google again.
 */
invites.post('/invites/:id/redeem', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  if (!isPlausibleInviteToken(id)) return c.json({ error: 'Invite not found' }, 404);
  const invite = await getInviteById(c.env.DB, id);
  if (!invite) return c.json({ error: 'Invite not found' }, 404);
  if (!isInviteValid(invite)) {
    return c.json({ error: `This invite is ${inviteStatus(invite)}`, status: inviteStatus(invite) }, 410);
  }
  if (invite.email && (!user.email || normalizeEmail(user.email) !== invite.email)) {
    return c.json({ error: 'This invite was sent to a different email address' }, 403);
  }
  if (invite.created_by === user.id) {
    return c.json({ error: 'This is your own invite link' }, 400);
  }
  const result = await redeemInvite(c.env.DB, user, invite);
  return c.json(result);
});

// ---------- Admin ----------

invites.get('/admin/access-requests', adminMiddleware, async (c) => {
  const status = c.req.query('status');
  const rows = await listAccessRequests(
    c.env.DB,
    status === 'all' || status === 'approved' || status === 'dismissed' ? status : 'pending'
  );
  return c.json(rows);
});

/**
 * Approve: create an email-bound invite from the admin so the person just
 * signs in again. No relationship, no decks — that is the tutor's job later.
 */
invites.post('/admin/access-requests/:id/approve', adminMiddleware, async (c) => {
  const admin = c.get('user');
  const request = await getAccessRequestById(c.env.DB, c.req.param('id'));
  if (!request) return c.json({ error: 'Access request not found' }, 404);

  const invite = await createInvite(c.env.DB, {
    created_by: admin.id,
    email: request.email,
    inviter_role: null,
    max_uses: 1,
    expires_in_days: 30,
    note: `Approved access request${request.name ? ` from ${request.name}` : ''}`,
  });
  await setAccessRequestStatus(c.env.DB, request.id, 'approved');

  return c.json({
    request: { ...request, status: 'approved' },
    invite: withUrl({
      ...invite,
      status: inviteStatus(invite),
      creator_name: admin.name,
      creator_email: admin.email,
      redemptions: [],
    }, resolveFrontendUrl(c.req.raw)),
  });
});

invites.post('/admin/access-requests/:id/dismiss', adminMiddleware, async (c) => {
  const request = await getAccessRequestById(c.env.DB, c.req.param('id'));
  if (!request) return c.json({ error: 'Access request not found' }, 404);
  await setAccessRequestStatus(c.env.DB, request.id, 'dismissed');
  return c.json({ ...request, status: 'dismissed' });
});

invites.put('/admin/users/:id/can-invite', adminMiddleware, async (c) => {
  const userId = c.req.param('id');
  const body = await c.req.json<{ can_invite?: unknown }>().catch(() => ({} as { can_invite?: unknown }));
  if (typeof body.can_invite !== 'boolean') {
    return c.json({ error: 'can_invite must be a boolean' }, 400);
  }
  const target = await c.env.DB
    .prepare('SELECT id FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: string }>();
  if (!target) return c.json({ error: 'User not found' }, 404);
  await setUserCanInvite(c.env.DB, userId, body.can_invite);
  return c.json({ id: userId, can_invite: body.can_invite });
});

export default invites;
