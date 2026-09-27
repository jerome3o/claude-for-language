/**
 * Admin: account inspection, role, deletion. Every route is behind
 * adminMiddleware (403 for everyone else) — the admin_* MCP tools call these
 * as the signed-in user, so the check lives here and only here.
 *
 * `:user` is a user id or an email.
 */
import { Hono } from 'hono';
import type { Env, UserRole } from '../types';
import { adminMiddleware } from '../middleware/auth';
import { inspectUser, inspectUserDecks, resolveUserRef, setUserRole, USER_ROLES } from '../services/admin/inspect';
import { AccountDeletionError, deleteUserAccount, previewUserDeletion } from '../services/admin/delete-user';

const admin = new Hono<{ Bindings: Env }>();

admin.use('/admin/*', adminMiddleware);

async function target(c: { env: Env; req: { param(name: string): string } }) {
  return resolveUserRef(c.env.DB, decodeURIComponent(c.req.param('user')));
}

admin.get('/admin/users/:user/inspect', async (c) => {
  const ref = await target(c);
  if (!ref) return c.json({ error: 'User not found' }, 404);
  const [info, decks] = await Promise.all([inspectUser(c.env.DB, ref.id), inspectUserDecks(c.env.DB, ref.id)]);
  return c.json({ ...info, decks });
});

admin.get('/admin/users/:user/decks', async (c) => {
  const ref = await target(c);
  if (!ref) return c.json({ error: 'User not found' }, 404);
  return c.json({ user: ref, ...(await inspectUserDecks(c.env.DB, ref.id)) });
});

admin.put('/admin/users/:user/role', async (c) => {
  const ref = await target(c);
  if (!ref) return c.json({ error: 'User not found' }, 404);
  const body = await c.req.json<{ role?: unknown }>().catch(() => ({} as { role?: unknown }));
  if (typeof body.role !== 'string' || !(USER_ROLES as readonly string[]).includes(body.role)) {
    return c.json({ error: `role must be one of: ${USER_ROLES.join(', ')}` }, 400);
  }
  await setUserRole(c.env.DB, ref.id, body.role as UserRole);
  console.log('[admin] role', ref.id, ref.email, '→', body.role, 'by', c.get('user').email);
  return c.json({ id: ref.id, email: ref.email, name: ref.name, role: body.role });
});

admin.get('/admin/users/:user/deletion-preview', async (c) => {
  const ref = await target(c);
  if (!ref) return c.json({ error: 'User not found' }, 404);
  const preview = await previewUserDeletion(c.env.DB, ref.id, { actorId: c.get('user').id, adminEmail: c.env.ADMIN_EMAIL });
  return c.json(preview);
});

admin.delete('/admin/users/:user', async (c) => {
  const ref = await target(c);
  if (!ref) return c.json({ error: 'User not found' }, 404);
  const body = await c.req.json<{ confirm_email?: unknown }>().catch(() => ({} as { confirm_email?: unknown }));
  try {
    const result = await deleteUserAccount(
      c.env,
      ref.id,
      {
        actorId: c.get('user').id,
        adminEmail: c.env.ADMIN_EMAIL,
        confirmEmail: typeof body.confirm_email === 'string' ? body.confirm_email : null,
      },
      c.executionCtx
    );
    return c.json(result);
  } catch (err) {
    if (err instanceof AccountDeletionError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

export default admin;
