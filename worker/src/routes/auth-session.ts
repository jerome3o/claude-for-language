/**
 * Sign-in sessions after the Google round trip (services/auth.ts):
 * - POST /api/auth/exchange   `{ code, verifier }` → `{ session_token, expires_at }` — the one-time
 *   code from the callback redirect, traded once, within 60 s, by the app holding the verifier.
 * - POST /api/auth/logout     revokes THIS session (the `Authorization: Bearer` token every app
 *   sends; the legacy cookie too). Always 200 — signing out never fails on the device.
 * - POST /api/auth/logout-all "Sign out of all devices": deletes every session of the account.
 *
 * Mounted before the auth middleware, so each handler resolves the session itself.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import {
  clearSessionCookie,
  deleteAllSessionsForUser,
  deleteSession,
  exchangeAuthCode,
  getSessionWithUser,
  sessionIdFromHeaders,
} from '../services/auth';

const app = new Hono<{ Bindings: Env }>();

const EXCHANGE_ERRORS: Record<string, string> = {
  invalid_request: 'Missing or malformed code / verifier.',
  invalid_code: 'This sign-in link was already used or is not valid. Please sign in again.',
  expired: 'This sign-in link has expired. Please sign in again.',
  nonce_mismatch: 'This sign-in was not started on this device. Please sign in again.',
};

app.post('/auth/exchange', async (c) => {
  const body = await c.req.json<{ code?: unknown; verifier?: unknown }>().catch(() => null);
  const result = await exchangeAuthCode(c.env.DB, body?.code, body?.verifier);
  if (!result.ok) {
    // Never log the code or the verifier.
    console.warn(JSON.stringify({ type: 'auth', event: 'exchange_refused', reason: result.reason }));
    return c.json({ error: EXCHANGE_ERRORS[result.reason], reason: result.reason }, 400);
  }
  return c.json(
    { session_token: result.session.id, expires_at: result.session.expires_at },
    200,
    { 'Cache-Control': 'no-store' },
  );
});

app.post('/auth/logout', async (c) => {
  const sessionId = sessionIdFromHeaders(c.req.header('Authorization'), c.req.header('Cookie'));
  if (sessionId) await deleteSession(c.env.DB, sessionId);
  const isSecure = c.req.url.startsWith('https');
  return c.json({ success: true, revoked: !!sessionId }, 200, { 'Set-Cookie': clearSessionCookie(isSecure) });
});

app.post('/auth/logout-all', async (c) => {
  const sessionId = sessionIdFromHeaders(c.req.header('Authorization'), c.req.header('Cookie'));
  const found = sessionId ? await getSessionWithUser(c.env.DB, sessionId) : null;
  if (!found) return c.json({ error: 'Unauthorized' }, 401);
  const signedOut = await deleteAllSessionsForUser(c.env.DB, found.user.id);
  console.log(JSON.stringify({ type: 'auth', event: 'logout_all', user_id: found.user.id, sessions: signedOut }));
  const isSecure = c.req.url.startsWith('https');
  return c.json({ success: true, signed_out: signedOut }, 200, { 'Set-Cookie': clearSessionCookie(isSecure) });
});

export default app;
