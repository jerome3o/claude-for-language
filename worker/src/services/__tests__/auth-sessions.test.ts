/**
 * Sign-in hardening (services/auth.ts, routes/auth-session.ts) against real SQLite with
 * every migration: the one-time code exchange (single use, 60 s, bound to the verifier),
 * logout revoking the Bearer session, "Sign out of all devices", and the verified-email
 * rule of findExistingUser.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import {
  AUTH_CODE_TTL_MS,
  authChallengeFor,
  cleanupExpiredAuthCodes,
  createAuthCode,
  createSession,
  exchangeAuthCode,
  findExistingUser,
  getSessionWithUser,
  sessionIdFromHeaders,
} from '../auth';
import authSessionRoutes from '../../routes/auth-session';
import type { Env } from '../../types';

const VERIFIER = 'v'.repeat(20) + 'ERIFIER_-0123456789abcdefghij'; // 49 chars, base64url alphabet
const OTHER_VERIFIER = 'o'.repeat(48);

let db: SqliteD1;

function addUser(id: string, email: string, googleId: string | null = null) {
  db.raw.run('INSERT INTO users (id, email, name, role, is_admin, google_id) VALUES (?, ?, ?, ?, 0, ?)', [id, email, id, 'student', googleId]);
}

function appFor(d1: D1Database) {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api', authSessionRoutes);
  return (path: string, init: RequestInit = {}) => app.request(path, init, { DB: d1 } as unknown as Env);
}

beforeEach(async () => {
  db = await createSqliteD1();
  addUser('u1', 'jerome@example.com', 'g-1');
  addUser('u2', 'minghui@example.com', 'g-2');
});

describe('one-time sign-in codes', () => {
  it('a code stores only its hash and trades once for a session', async () => {
    const challenge = await authChallengeFor(VERIFIER);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const code = await createAuthCode(db, 'u1', challenge, 'web');
    const stored = db.rows<{ code_hash: string; client: string }>('SELECT code_hash, client FROM auth_codes');
    expect(stored).toHaveLength(1);
    expect(stored[0].code_hash).not.toContain(code);
    expect(stored[0].client).toBe('web');

    const first = await exchangeAuthCode(db, code, VERIFIER);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.client).toBe('web');
    expect((await getSessionWithUser(db, first.session.id))?.user.id).toBe('u1');

    // Single use: the row is gone, a replay is refused.
    expect(db.rows('SELECT * FROM auth_codes')).toHaveLength(0);
    expect(await exchangeAuthCode(db, code, VERIFIER)).toEqual({ ok: false, reason: 'invalid_code' });
  });

  it('expires after 60 s', async () => {
    const t0 = 1_800_000_000_000;
    const code = await createAuthCode(db, 'u1', await authChallengeFor(VERIFIER), 'lab', t0);
    expect(await exchangeAuthCode(db, code, VERIFIER, t0 + AUTH_CODE_TTL_MS)).toEqual({ ok: false, reason: 'expired' });
    const fresh = await createAuthCode(db, 'u1', await authChallengeFor(VERIFIER), 'lab', t0);
    expect((await exchangeAuthCode(db, fresh, VERIFIER, t0 + AUTH_CODE_TTL_MS - 1)).ok).toBe(true);
  });

  it('a different verifier (the attacker’s code in my browser) is refused and burns the code', async () => {
    const code = await createAuthCode(db, 'u1', await authChallengeFor(VERIFIER), 'web');
    expect(await exchangeAuthCode(db, code, OTHER_VERIFIER)).toEqual({ ok: false, reason: 'nonce_mismatch' });
    // No second guess.
    expect(await exchangeAuthCode(db, code, VERIFIER)).toEqual({ ok: false, reason: 'invalid_code' });
    expect(db.rows('SELECT * FROM auth_sessions')).toHaveLength(0);
  });

  it('refuses malformed input without touching the table', async () => {
    const code = await createAuthCode(db, 'u1', await authChallengeFor(VERIFIER), 'web');
    for (const [c, v] of [[undefined, VERIFIER], [code, undefined], [code, 'short'], ['bad code!', VERIFIER], [42, VERIFIER]] as const) {
      expect(await exchangeAuthCode(db, c, v)).toEqual({ ok: false, reason: 'invalid_request' });
    }
    expect(db.rows('SELECT * FROM auth_codes')).toHaveLength(1);
  });

  it('the cron prunes expired codes only', async () => {
    const t0 = 1_800_000_000_000;
    await createAuthCode(db, 'u1', await authChallengeFor(VERIFIER), 'web', t0);
    await createAuthCode(db, 'u1', await authChallengeFor(VERIFIER), 'web', t0 + 120_000);
    expect(await cleanupExpiredAuthCodes(db, t0 + 90_000)).toBe(1);
    expect(db.rows('SELECT * FROM auth_codes')).toHaveLength(1);
  });

  it('POST /api/auth/exchange answers the token, 400 with a reason otherwise', async () => {
    const call = appFor(db);
    const code = await createAuthCode(db, 'u2', await authChallengeFor(VERIFIER), 'desktop');
    const post = (body: unknown) => call('/api/auth/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const ok = await post({ code, verifier: VERIFIER });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('no-store');
    const { session_token } = await ok.json() as { session_token: string };
    expect((await getSessionWithUser(db, session_token))?.user.id).toBe('u2');

    const again = await post({ code, verifier: VERIFIER });
    expect(again.status).toBe(400);
    expect(((await again.json()) as { reason: string }).reason).toBe('invalid_code');
    const junk = await call('/api/auth/exchange', { method: 'POST', body: 'not json' });
    expect(junk.status).toBe(400);
  });
});

describe('logout', () => {
  it('revokes the Bearer session (and only that one)', async () => {
    const call = appFor(db);
    const phone = await createSession(db, 'u1');
    const laptop = await createSession(db, 'u1');
    const res = await call('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${phone.id}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, revoked: true });
    expect(await getSessionWithUser(db, phone.id)).toBeNull();
    expect(await getSessionWithUser(db, laptop.id)).not.toBeNull();
  });

  it('still answers 200 with no or an unknown token', async () => {
    const call = appFor(db);
    expect((await call('/api/auth/logout', { method: 'POST' })).status).toBe(200);
    expect((await call('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer nope' } })).status).toBe(200);
  });

  it('sign out of all devices deletes every session of that account, nobody else’s', async () => {
    const call = appFor(db);
    const a = await createSession(db, 'u1');
    await createSession(db, 'u1');
    await createSession(db, 'u1');
    const other = await createSession(db, 'u2');
    const res = await call('/api/auth/logout-all', { method: 'POST', headers: { Authorization: `Bearer ${a.id}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, signed_out: 3 });
    expect(db.rows("SELECT * FROM auth_sessions WHERE user_id = 'u1'")).toHaveLength(0);
    expect(await getSessionWithUser(db, other.id)).not.toBeNull();
  });

  it('sign out of all devices needs a valid session', async () => {
    const call = appFor(db);
    expect((await call('/api/auth/logout-all', { method: 'POST' })).status).toBe(401);
    expect((await call('/api/auth/logout-all', { method: 'POST', headers: { Authorization: 'Bearer nope' } })).status).toBe(401);
  });

  it('reads the session from the Bearer header, else the legacy cookie', () => {
    expect(sessionIdFromHeaders('Bearer abc', 'session=xyz')).toBe('abc');
    expect(sessionIdFromHeaders(undefined, 'a=1; session=xyz')).toBe('xyz');
    expect(sessionIdFromHeaders('Bearer ', null)).toBeNull();
    expect(sessionIdFromHeaders(null, null)).toBeNull();
  });
});

describe('findExistingUser: verified email', () => {
  it('matches by google_id whatever the email says', async () => {
    const u = await findExistingUser(db, { id: 'g-1', email: 'whatever@example.com', verified_email: false });
    expect(u?.id).toBe('u1');
  });

  it('matches by email only when Google verified it', async () => {
    addUser('u3', 'invited@example.com');
    expect((await findExistingUser(db, { id: 'g-new', email: 'invited@example.com', verified_email: true }))?.id).toBe('u3');
    expect(await findExistingUser(db, { id: 'g-new', email: 'invited@example.com', verified_email: false })).toBeNull();
    expect(await findExistingUser(db, { id: 'g-new', email: 'invited@example.com' } as never)).toBeNull();
  });
});
