/**
 * Chat e-mail opt-out (docs/CHAT.md "E-mail opt-out").
 *
 * Public (mounted BEFORE the auth middleware — the token is the credential):
 *   GET  /api/email/unsubscribe?t=[&k=homework]   the confirmation page; it turns those e-mails off as it loads in a browser
 *   POST /api/email/unsubscribe?t=[&k=homework]   off — also the RFC 8058 one-click target (body "List-Unsubscribe=One-Click")
 *   POST /api/email/resubscribe?t=[&k=homework]   back on
 *   (JSON `{ email_chat_messages }` / `{ email_homework }` when the request accepts JSON, else the page.)
 *   No `k` = chat e-mails (every link already sent); `k=homework` = homework e-mails
 *   (docs/HOMEWORK.md §12) — the token is signed for that purpose, so a chat link can't flip it.
 *
 * Signed in (mounted under /api after the auth middleware):
 *   PUT  /api/profile/email-prefs    { email_chat_messages?: boolean, email_homework?: boolean } — Settings on web and in the Lab app
 *   PUT  /api/profile/chat-prefs     { chat_auto_check: boolean | null } — "Check my Chinese automatically"
 *                                    (Settings → Chat; null = the default, on for the learner side; docs/CHAT.md "Auto-check")
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { purposeFromQuery, unsubscribePageHtml, verifyUnsubscribeToken, type UnsubscribePurpose } from '../services/email-unsubscribe';
import { APP_BASE_URL } from '../services/email';
import { setChatAutoCheck } from '../services/chat/auto-check';

export async function setChatEmails(db: D1Database, userId: string, on: boolean): Promise<boolean> {
  const res = await db.prepare('UPDATE users SET email_chat_messages = ? WHERE id = ?').bind(on ? 1 : 0, userId).run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function setHomeworkEmails(db: D1Database, userId: string, on: boolean): Promise<boolean> {
  const res = await db.prepare('UPDATE users SET email_homework = ? WHERE id = ?').bind(on ? 1 : 0, userId).run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function chatEmailsOn(db: D1Database, userId: string): Promise<boolean> {
  const row = await db.prepare('SELECT email_chat_messages FROM users WHERE id = ?').bind(userId).first<{ email_chat_messages: number | null }>();
  return row?.email_chat_messages !== 0;
}

function page(c: Context<{ Bindings: Env }>, token: string, state: 'pending' | 'off' | 'on' | 'invalid', status: 200 | 400 = 200, purpose: UnsubscribePurpose = 'chat') {
  return c.html(unsubscribePageHtml({ token, state, appUrl: APP_BASE_URL, purpose }), status, {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex',
  });
}

const wantsJson = (c: Context<{ Bindings: Env }>) => (c.req.header('Accept') ?? '').includes('application/json');

export const emailPublic = new Hono<{ Bindings: Env }>();

emailPublic.get('/unsubscribe', async (c) => {
  const token = c.req.query('t') ?? '';
  const purpose = purposeFromQuery(c.req.query('k'));
  const userId = await verifyUnsubscribeToken(c.env, token, purpose);
  if (!userId) return page(c, token, 'invalid', 400, purpose);
  // Nothing changes on a GET (mail scanners open links): the page POSTs.
  return page(c, token, 'pending', 200, purpose);
});

async function change(c: Context<{ Bindings: Env }>, on: boolean) {
  const token = c.req.query('t') ?? '';
  const purpose = purposeFromQuery(c.req.query('k'));
  const userId = await verifyUnsubscribeToken(c.env, token, purpose);
  if (!userId) return wantsJson(c) ? c.json({ error: 'Invalid link' }, 400) : page(c, token, 'invalid', 400, purpose);
  const found = purpose === 'homework' ? await setHomeworkEmails(c.env.DB, userId, on) : await setChatEmails(c.env.DB, userId, on);
  if (!found) return wantsJson(c) ? c.json({ error: 'Account not found' }, 404) : page(c, token, 'invalid', 400, purpose);
  console.log(`[email-prefs] ${purpose} e-mails ${on ? 'on' : 'off'} for ${userId} (link)`);
  const json = purpose === 'homework' ? { email_homework: on } : { email_chat_messages: on };
  return wantsJson(c) ? c.json(json) : page(c, token, on ? 'on' : 'off', 200, purpose);
}

emailPublic.post('/unsubscribe', (c) => change(c, false));
emailPublic.post('/resubscribe', (c) => change(c, true));

export const emailPrefs = new Hono<{ Bindings: Env }>();

emailPrefs.put('/profile/email-prefs', async (c) => {
  type Body = { email_chat_messages?: unknown; email_homework?: unknown };
  const body = await c.req.json<Body>().catch(() => ({} as Body));
  const chat = body.email_chat_messages;
  const homework = body.email_homework;
  if (chat === undefined && homework === undefined) return c.json({ error: 'email_chat_messages or email_homework is required' }, 400);
  if (chat !== undefined && typeof chat !== 'boolean') return c.json({ error: 'email_chat_messages must be true or false' }, 400);
  if (homework !== undefined && typeof homework !== 'boolean') return c.json({ error: 'email_homework must be true or false' }, 400);
  const userId = c.get('user').id;
  if (typeof chat === 'boolean') await setChatEmails(c.env.DB, userId, chat);
  if (typeof homework === 'boolean') await setHomeworkEmails(c.env.DB, userId, homework);
  const row = await c.env.DB
    .prepare('SELECT email_chat_messages, email_homework FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email_chat_messages: number | null; email_homework: number | null }>();
  return c.json({ email_chat_messages: row?.email_chat_messages !== 0, email_homework: row?.email_homework !== 0 });
});

emailPrefs.put('/profile/chat-prefs', async (c) => {
  const body = await c.req.json<{ chat_auto_check?: unknown }>().catch(() => ({} as { chat_auto_check?: unknown }));
  const v = body.chat_auto_check;
  if (v !== null && typeof v !== 'boolean') return c.json({ error: 'chat_auto_check must be true, false or null' }, 400);
  await setChatAutoCheck(c.env.DB, c.get('user').id, v);
  return c.json({ chat_auto_check: v });
});
