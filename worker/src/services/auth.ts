import { Env, User, AuthSession } from '../types';
import { googleProfileRefresh } from './profile';
import { trackServer } from './analytics/server-events';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A sign-in session lives 30 days from its last renewal (sliding: getSessionWithUser renews it). */
export const SESSION_DURATION_MS = 30 * DAY_MS;
/**
 * A session used with less than this left is renewed to SESSION_DURATION_MS from now. 20 of
 * 30 days means at most one UPDATE per session per ~10 days of use, and an app opened at least
 * once a month never signs out by itself (Jerome's Lab app silently lost its session 30 days
 * after sign-in, Oct 2026: every upload / transcription got 401 while offline study kept working).
 */
export const SESSION_RENEW_WHEN_LEFT_MS = 20 * DAY_MS;
/**
 * Only sessions made to last (a sign-in: 30 days) slide. The MCP server mints 5-minute rows per
 * tool call and deletes them after; those must never be stretched to a month.
 */
const RENEWABLE_MIN_LIFETIME_MS = DAY_MS;

interface GoogleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
}

export interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  given_name?: string;
  family_name?: string;
  picture: string;
  locale?: string;
}

function generateId(): string {
  return crypto.randomUUID();
}

async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function getGoogleAuthUrl(env: Env, state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: state,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  env: Env,
  code: string,
  redirectUri: string
): Promise<GoogleTokenResponse> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to exchange code for tokens: ${error}`);
  }

  return response.json();
}

export async function getGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Failed to get user info from Google');
  }

  return response.json();
}

/**
 * Find the users row for a Google account: by google_id first, then by email
 * (a user created before Google sign-in, or by an invite / test endpoint).
 * The email match needs Google to have VERIFIED the address: a Google account
 * can carry an unverified address it doesn't own, and must never take over the
 * row of the person who does. The google_id match is unchanged.
 */
export async function findExistingUser(
  db: D1Database,
  googleUser: Pick<GoogleUserInfo, 'id' | 'email' | 'verified_email'>,
): Promise<User | null> {
  const byGoogleId = await db
    .prepare('SELECT * FROM users WHERE google_id = ?')
    .bind(googleUser.id)
    .first<User>();
  if (byGoogleId) return byGoogleId;

  if (!isVerifiedGoogleEmail(googleUser)) return null;
  return db
    .prepare('SELECT * FROM users WHERE email = ?')
    .bind(googleUser.email)
    .first<User>();
}

/**
 * Stamp a sign-in: link the google_id, last_login_at, email, admin flag, and
 * remember Google's name / picture. Those only become the displayed ones while
 * the user hasn't set their own on the Profile screen (services/profile.ts).
 */
export async function touchExistingUser(
  db: D1Database,
  user: User,
  googleUser: GoogleUserInfo,
  isAdminEmail: boolean
): Promise<User> {
  await googleProfileRefresh(
    db,
    user.id,
    { id: googleUser.id, name: googleUser.name ?? null, picture: googleUser.picture ?? null, email: googleUser.email },
    isAdminEmail ? 1 : user.is_admin
  ).run();

  const updated = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(user.id)
    .first<User>();
  return updated ?? user;
}

/** Insert a brand-new user for a Google account. Callers gate this on an invite. */
export async function createUser(
  db: D1Database,
  googleUser: GoogleUserInfo,
  isAdminEmail: boolean
): Promise<User> {
  const id = generateId();
  await db
    .prepare(`
      INSERT INTO users (id, email, google_id, name, picture_url, google_name, google_picture_url, role, is_admin, last_login_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'student', ?, datetime('now'))
    `)
    .bind(
      id,
      googleUser.email,
      googleUser.id,
      googleUser.name,
      googleUser.picture,
      googleUser.name ?? null,
      googleUser.picture ?? null,
      isAdminEmail ? 1 : 0
    )
    .run();

  const user = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(id)
    .first<User>();
  return user!;
}

/**
 * Ungated get-or-create (kept for callers that have already decided the
 * account is allowed in). The Google callback uses resolveSignup instead.
 */
export async function getOrCreateUser(
  db: D1Database,
  googleUser: GoogleUserInfo,
  isAdminEmail: boolean
): Promise<{ user: User; isNewUser: boolean }> {
  const existing = await findExistingUser(db, googleUser);
  if (existing) {
    return { user: await touchExistingUser(db, existing, googleUser, isAdminEmail), isNewUser: false };
  }
  return { user: await createUser(db, googleUser, isAdminEmail), isNewUser: true };
}

export async function createSession(db: D1Database, userId: string): Promise<AuthSession> {
  const id = generateId();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  await db
    .prepare('INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(id, userId, expiresAt)
    .run();

  const session = await db
    .prepare('SELECT * FROM auth_sessions WHERE id = ?')
    .bind(id)
    .first<AuthSession>();

  return session!;
}

export async function getSessionWithUser(
  db: D1Database,
  sessionId: string,
  nowMs: number = Date.now(),
): Promise<{ session: AuthSession; user: User } | null> {
  const session = await db
    .prepare('SELECT * FROM auth_sessions WHERE id = ?')
    .bind(sessionId)
    .first<AuthSession>();

  if (!session) return null;

  // Check if session is expired
  if (new Date(session.expires_at).getTime() < nowMs) {
    // Clean up expired session
    await db.prepare('DELETE FROM auth_sessions WHERE id = ?').bind(sessionId).run();
    return null;
  }

  const user = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(session.user_id)
    .first<User>();

  if (!user) return null;

  const renewed = await renewSessionIfDue(db, session, nowMs);
  return { session: renewed, user };
}

/**
 * Sliding sessions: a session in use with less than SESSION_RENEW_WHEN_LEFT_MS left gets
 * SESSION_DURATION_MS from now (one UPDATE, guarded so a racing request or a short-lived MCP
 * row is never touched). A renewal failure never fails the request.
 */
export async function renewSessionIfDue(db: D1Database, session: AuthSession, nowMs: number = Date.now()): Promise<AuthSession> {
  const expiresMs = new Date(session.expires_at).getTime();
  if (!Number.isFinite(expiresMs) || expiresMs - nowMs >= SESSION_RENEW_WHEN_LEFT_MS) return session;
  const createdMs = session.created_at ? new Date(session.created_at.includes('T') ? session.created_at : session.created_at.replace(' ', 'T') + 'Z').getTime() : NaN;
  if (Number.isFinite(createdMs) && expiresMs - createdMs < RENEWABLE_MIN_LIFETIME_MS) return session;
  const next = new Date(nowMs + SESSION_DURATION_MS).toISOString();
  try {
    const res = await db
      .prepare(
        `UPDATE auth_sessions SET expires_at = ?1
         WHERE id = ?2 AND julianday(expires_at) < julianday(?3)
           AND (created_at IS NULL OR julianday(expires_at) - julianday(created_at) >= 1)`,
      )
      .bind(next, session.id, new Date(nowMs + SESSION_RENEW_WHEN_LEFT_MS).toISOString())
      .run();
    if ((res.meta?.changes ?? 0) > 0) {
      void trackServer('auth.session_renewed', { days_left: Math.max(0, Math.floor((expiresMs - nowMs) / DAY_MS)) }, { userId: session.user_id });
      return { ...session, expires_at: next };
    }
  } catch (err) {
    console.warn('[auth] session renewal failed:', err instanceof Error ? err.message : err);
  }
  return session;
}

export async function deleteSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('DELETE FROM auth_sessions WHERE id = ?').bind(sessionId).run();
}

/** "Sign out of all devices": every session of the user (this one too). Returns how many went. */
export async function deleteAllSessionsForUser(db: D1Database, userId: string): Promise<number> {
  const res = await db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(userId).run();
  return res.meta?.changes ?? 0;
}

/** The session id a request carries: `Authorization: Bearer <id>` (every app), else the legacy cookie. */
export function sessionIdFromHeaders(authorization: string | null | undefined, cookieHeader: string | null | undefined): string | null {
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice(7).trim();
    return token || null;
  }
  return parseSessionCookie(cookieHeader ?? null);
}

/** Google says it verified this address (userinfo v2 `verified_email`). Anything else counts as unverified. */
export function isVerifiedGoogleEmail(googleUser: Pick<GoogleUserInfo, 'verified_email'>): boolean {
  return googleUser.verified_email === true;
}

// ------------------------------------------------------------------ one-time sign-in codes

/**
 * Sign-in hands the app a ONE-TIME CODE, never the session token itself
 * (CLAUDE.md "Sign-in"). Before leaving for Google the app makes a random
 * `verifier`, keeps it (web: sessionStorage; Lab / desktop: the app's own
 * storage) and sends only its SHA-256 (`challenge`, base64url, 43 characters —
 * PKCE S256) to /api/auth/login. The callback stores the code's hash with the
 * user and the challenge and redirects with `?code=`; the app then POSTs
 * `{ code, verifier }` to /api/auth/exchange for the session token. A code
 * lives 60 s and works once, and only for the app that holds the verifier — so
 * a link carrying someone else's code (login CSRF) or a code read off the
 * custom-scheme redirect by another app is worthless.
 */
export const AUTH_CODE_TTL_MS = 60_000;
export const AUTH_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const AUTH_VERIFIER_RE = /^[A-Za-z0-9_-]{32,128}$/;
const AUTH_CODE_RE = /^[A-Za-z0-9_-]{32,128}$/;

export function parseAuthChallenge(value: string | null | undefined): string | null {
  return value && AUTH_CHALLENGE_RE.test(value) ? value : null;
}

function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** PKCE S256: base64url(SHA-256(verifier)), no padding. */
export async function authChallengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** Constant-time compare of two equal-length strings (hashes here). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Make a one-time code for `userId`, bound to the app's challenge. Only its hash is stored. */
export async function createAuthCode(
  db: D1Database,
  userId: string,
  challenge: string,
  client: string,
  nowMs: number = Date.now(),
): Promise<string> {
  const code = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  await db
    .prepare('INSERT INTO auth_codes (code_hash, user_id, challenge, client, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await hashString(code), userId, challenge, client, nowMs, nowMs + AUTH_CODE_TTL_MS)
    .run();
  return code;
}

export type AuthCodeExchange =
  | { ok: true; session: AuthSession; client: string }
  | { ok: false; reason: 'invalid_request' | 'invalid_code' | 'expired' | 'nonce_mismatch' };

/**
 * Trade a code + verifier for a new session. The code row is DELETED by the same
 * statement that reads it, so a code works once even when two requests race —
 * and a wrong verifier burns it too (no second guess).
 */
export async function exchangeAuthCode(
  db: D1Database,
  code: unknown,
  verifier: unknown,
  nowMs: number = Date.now(),
): Promise<AuthCodeExchange> {
  if (typeof code !== 'string' || !AUTH_CODE_RE.test(code) || typeof verifier !== 'string' || !AUTH_VERIFIER_RE.test(verifier)) {
    return { ok: false, reason: 'invalid_request' };
  }
  const row = await db
    .prepare('DELETE FROM auth_codes WHERE code_hash = ? RETURNING user_id, challenge, client, expires_at')
    .bind(await hashString(code))
    .first<{ user_id: string; challenge: string; client: string; expires_at: number }>();
  if (!row) return { ok: false, reason: 'invalid_code' };
  if (Number(row.expires_at) <= nowMs) return { ok: false, reason: 'expired' };
  if (!safeEqual(await authChallengeFor(verifier), row.challenge)) return { ok: false, reason: 'nonce_mismatch' };
  const session = await createSession(db, row.user_id);
  return { ok: true, session, client: row.client };
}

/** The daily cron: codes nobody exchanged. */
export async function cleanupExpiredAuthCodes(db: D1Database, nowMs: number = Date.now()): Promise<number> {
  const res = await db.prepare('DELETE FROM auth_codes WHERE expires_at <= ?').bind(nowMs).run();
  return res.meta?.changes ?? 0;
}

/**
 * Delete every expired session (the daily cron). `expires_at` is ISO 8601 ("…T…Z"), so it
 * is compared as a time, not as text against SQLite's "YYYY-MM-DD HH:MM:SS".
 */
export async function cleanupExpiredSessions(db: D1Database, nowMs: number = Date.now()): Promise<number> {
  const res = await db
    .prepare('DELETE FROM auth_sessions WHERE julianday(expires_at) < julianday(?)')
    .bind(new Date(nowMs).toISOString())
    .run();
  return res.meta?.changes ?? 0;
}

// Session cookie helpers
export function createSessionCookie(sessionId: string, secure: boolean = true): string {
  const maxAge = SESSION_DURATION_MS / 1000; // Convert to seconds
  const parts = [
    `session=${sessionId}`,
    `Path=/`,
    `HttpOnly`,
    // SameSite=None required for cross-origin cookies (frontend and API on different domains)
    `SameSite=${secure ? 'None' : 'Lax'}`,
    `Max-Age=${maxAge}`,
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function clearSessionCookie(secure: boolean = true): string {
  const parts = [
    'session=',
    'Path=/',
    'HttpOnly',
    `SameSite=${secure ? 'None' : 'Lax'}`,
    'Max-Age=0',
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function parseSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [name, value] = cookie.split('=');
    if (name === 'session' && value) {
      return value;
    }
  }
  return null;
}

// State cookie for OAuth CSRF protection
export function createStateCookie(state: string, secure: boolean = true): string {
  const parts = [
    `oauth_state=${state}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=600', // 10 minutes
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function clearStateCookie(secure: boolean = true): string {
  const parts = [
    'oauth_state=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function parseStateCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [name, value] = cookie.split('=');
    if (name === 'oauth_state' && value) {
      return value;
    }
  }
  return null;
}

export function generateState(): string {
  return generateId();
}

/**
 * Native apps that sign in through a browser tab and get the session back on a
 * custom-scheme redirect instead of the web app's `?session_token=` URL.
 * `lab` is the experimental pure-native Android app (android-lab/); `desktop` is
 * the Electron desktop app (desktop/, shared/desktop/bridge.ts), which signs in
 * in the system browser because Google refuses OAuth inside embedded browsers.
 */
export const NATIVE_AUTH_CLIENTS: Record<string, string> = {
  lab: 'chineselearning-lab://auth',
  desktop: 'chineselearning-desktop://auth',
};

export interface NativeAuthClient {
  client: string;
  /** Random value the app generated; echoed back so it only accepts the redirect it asked for. */
  appNonce: string;
}

/*
 * Transition (Oct 2026): a sign-in WITHOUT a `challenge` still ends with the old
 * redirect carrying `session_token` — Lab and desktop builds from before the
 * code exchange, and a web tab still running a cached older bundle. The web app
 * itself no longer accepts `?session_token=` (only on the Vite dev server, for
 * E2E), so the legacy web redirect gives an attacker nothing. Plan: once every
 * installed Lab / desktop app has updated (the debug reports' app_version shows
 * it), drop the legacy path — /api/auth/login then requires `challenge`.
 */

const APP_NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Validate `?client=&nonce=` from /api/auth/login; anything unexpected is ignored (web sign-in). */
export function parseNativeAuthClient(client: string | null | undefined, appNonce: string | null | undefined): NativeAuthClient | null {
  if (!client || !Object.prototype.hasOwnProperty.call(NATIVE_AUTH_CLIENTS, client)) return null;
  if (!appNonce || !APP_NONCE_RE.test(appNonce)) return null;
  return { client, appNonce };
}

/**
 * The OAuth `state` is a CSRF nonce; when sign-in starts from an invite link it
 * also carries the invite token (`<nonce>.i.<token>`), and when a native app
 * started it, the app (`<nonce>.c.<client>.<appNonce>`). Both can appear:
 * `<nonce>.c.<client>.<appNonce>.i.<token>`. The whole string goes into the
 * HttpOnly state cookie and must match on callback, so nothing can be swapped
 * in transit.
 */
export function encodeOAuthState(
  nonce: string,
  inviteToken: string | null | undefined,
  native?: NativeAuthClient | null,
  challenge?: string | null,
): string {
  let state = nonce;
  if (native) state += `.c.${native.client}.${native.appNonce}`;
  if (challenge) state += `.x.${challenge}`;
  if (inviteToken) state += `.i.${inviteToken}`;
  return state;
}

/** `<nonce>[.c.<client>.<appNonce>][.x.<challenge>][.i.<invite>]` — none of the parts contain a dot. */
export function parseOAuthState(state: string | null | undefined): {
  nonce: string;
  inviteToken: string | null;
  native: NativeAuthClient | null;
  /** The app's PKCE challenge: the sign-in ends with a one-time code instead of the session token. */
  challenge: string | null;
} {
  if (!state) return { nonce: '', inviteToken: null, native: null, challenge: null };
  const idx = state.indexOf('.i.');
  let head = idx === -1 ? state : state.slice(0, idx);
  const inviteToken = idx === -1 ? null : state.slice(idx + 3) || null;
  let challenge: string | null = null;
  const x = head.indexOf('.x.');
  if (x !== -1) {
    challenge = parseAuthChallenge(head.slice(x + 3));
    head = head.slice(0, x);
  }
  const c = head.indexOf('.c.');
  if (c === -1) return { nonce: head, inviteToken, native: null, challenge };
  const [client, appNonce] = head.slice(c + 3).split('.');
  return { nonce: head.slice(0, c), inviteToken, native: parseNativeAuthClient(client, appNonce), challenge };
}

/**
 * Where the auth callback sends the browser: the web app, or a native app's
 * custom scheme (with the app's nonce echoed back).
 */
export function authRedirectUrl(
  frontendUrl: string,
  native: NativeAuthClient | null,
  params: Record<string, string>,
): string {
  const query = new URLSearchParams(params);
  if (native) {
    query.set('nonce', native.appNonce);
    return `${NATIVE_AUTH_CLIENTS[native.client]}?${query.toString()}`;
  }
  return `${frontendUrl}?${query.toString()}`;
}

/**
 * Where the SPA lives, for redirects and invite URLs. The API and the frontend
 * are on different origins in production, so prefer the caller's Origin (or
 * Referer) and fall back to the deployed Pages URL / local dev server.
 */
export function resolveFrontendUrl(req: Request): string {
  const origin = req.headers.get('Origin');
  if (origin && /^https?:\/\//.test(origin)) return origin;
  const referer = req.headers.get('Referer');
  if (referer) {
    try { return new URL(referer).origin; } catch { /* fall through */ }
  }
  return req.url.startsWith('https') ? 'https://chinese-learning-2x9.pages.dev' : 'http://localhost:3000';
}

// Get all users for admin page
export async function getAllUsers(db: D1Database): Promise<User[]> {
  const result = await db
    .prepare('SELECT * FROM users ORDER BY created_at DESC')
    .all<User>();
  return result.results;
}

// Get statistics for a user (for admin page)
export interface UserStats {
  deck_count: number;
  note_count: number;
  review_count: number;
}

export async function getUserStats(db: D1Database, userId: string): Promise<UserStats> {
  const [deckCount, noteCount, reviewCount] = await Promise.all([
    db.prepare('SELECT COUNT(*) as count FROM decks WHERE user_id = ?')
      .bind(userId)
      .first<{ count: number }>(),
    db.prepare(`
      SELECT COUNT(*) as count FROM notes n
      JOIN decks d ON n.deck_id = d.id
      WHERE d.user_id = ?
    `)
      .bind(userId)
      .first<{ count: number }>(),
    db.prepare(`
      SELECT COUNT(*) as count FROM review_events
      WHERE user_id = ?
    `)
      .bind(userId)
      .first<{ count: number }>(),
  ]);

  return {
    deck_count: deckCount?.count || 0,
    note_count: noteCount?.count || 0,
    review_count: reviewCount?.count || 0,
  };
}

// Get stats for all users at once (more efficient for admin page)
export async function getAllUsersWithStats(db: D1Database): Promise<(User & UserStats)[]> {
  const users = await getAllUsers(db);

  // Get all stats in parallel
  const statsPromises = users.map(user => getUserStats(db, user.id));
  const allStats = await Promise.all(statsPromises);

  return users.map((user, index) => ({
    ...user,
    ...allStats[index],
  }));
}
