/**
 * Chat e-mail opt-out (docs/CHAT.md "E-mail opt-out").
 *
 * Public (mounted BEFORE the auth middleware — the token is the credential):
 *   GET  /api/email/unsubscribe?t=   the confirmation page; it turns chat e-mails off as it loads in a browser
 *   POST /api/email/unsubscribe?t=   off — also the RFC 8058 one-click target (body "List-Unsubscribe=One-Click")
 *   POST /api/email/resubscribe?t=   back on
 *   (JSON `{ email_chat_messages }` when the request accepts JSON, else the page.)
 *
 * Signed in (mounted under /api after the auth middleware):
 *   PUT  /api/profile/email-prefs    { email_chat_messages: boolean } — Settings on web and in the Lab app
 *   PUT  /api/profile/chat-prefs     { chat_auto_check: boolean | null } — "Check my Chinese automatically"
 *                                    (Settings → Chat; null = the default, on for the learner side; docs/CHAT.md "Auto-check")
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { unsubscribePageHtml, verifyUnsubscribeToken } from '../services/email-unsubscribe';
import { APP_BASE_URL } from '../services/email';
import { setChatAutoCheck } from '../services/chat/auto-check';

export async function setChatEmails(db: D1Database, userId: string, on: boolean): Promise<boolean> {
  const res = await db.prepare('UPDATE users SET email_chat_messages = ? WHERE id = ?').bind(on ? 1 : 0, userId).run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function chatEmailsOn(db: D1Database, userId: string): Promise<boolean> {
  const row = await db.prepare('SELECT email_chat_messages FROM users WHERE id = ?').bind(userId).first<{ email_chat_messages: number | null }>();
  return row?.email_chat_messages !== 0;
}

function page(c: Context<{ Bindings: Env }>, token: string, state: 'pending' | 'off' | 'on' | 'invalid', status: 200 | 400 = 200) {
  return c.html(unsubscribePageHtml({ token, state, appUrl: APP_BASE_URL }), status, {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex',
  });
}

const wantsJson = (c: Context<{ Bindings: Env }>) => (c.req.header('Accept') ?? '').includes('application/json');

export const emailPublic = new Hono<{ Bindings: Env }>();

emailPublic.get('/unsubscribe', async (c) => {
  const token = c.req.query('t') ?? '';
  const userId = await verifyUnsubscribeToken(c.env, token);
  if (!userId) return page(c, token, 'invalid', 400);
  // Nothing changes on a GET (mail scanners open links): the page POSTs.
  return page(c, token, 'pending');
});

async function change(c: Context<{ Bindings: Env }>, on: boolean) {
  const token = c.req.query('t') ?? '';
  const userId = await verifyUnsubscribeToken(c.env, token);
  if (!userId) return wantsJson(c) ? c.json({ error: 'Invalid link' }, 400) : page(c, token, 'invalid', 400);
  const found = await setChatEmails(c.env.DB, userId, on);
  if (!found) return wantsJson(c) ? c.json({ error: 'Account not found' }, 404) : page(c, token, 'invalid', 400);
  console.log(`[email-prefs] chat e-mails ${on ? 'on' : 'off'} for ${userId} (link)`);
  return wantsJson(c) ? c.json({ email_chat_messages: on }) : page(c, token, on ? 'on' : 'off');
}

emailPublic.post('/unsubscribe', (c) => change(c, false));
emailPublic.post('/resubscribe', (c) => change(c, true));

export const emailPrefs = new Hono<{ Bindings: Env }>();

emailPrefs.put('/profile/email-prefs', async (c) => {
  const body = await c.req.json<{ email_chat_messages?: unknown }>().catch(() => ({} as { email_chat_messages?: unknown }));
  if (typeof body.email_chat_messages !== 'boolean') return c.json({ error: 'email_chat_messages must be true or false' }, 400);
  await setChatEmails(c.env.DB, c.get('user').id, body.email_chat_messages);
  return c.json({ email_chat_messages: body.email_chat_messages });
});

emailPrefs.put('/profile/chat-prefs', async (c) => {
  const body = await c.req.json<{ chat_auto_check?: unknown }>().catch(() => ({} as { chat_auto_check?: unknown }));
  const v = body.chat_auto_check;
  if (v !== null && typeof v !== 'boolean') return c.json({ error: 'chat_auto_check must be true, false or null' }, 400);
  await setChatAutoCheck(c.env.DB, c.get('user').id, v);
  return c.json({ chat_auto_check: v });
});
