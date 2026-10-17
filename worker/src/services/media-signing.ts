/**
 * Credentials for private media (shared/media/access.ts, docs/AUDIO.md "Private media").
 *
 * Two kinds, both HMAC-SHA256 with keys derived from SESSION_SECRET (each purpose its own key):
 *
 * - A SIGNED LINK `/api/audio/<key>?exp=&sig=` serves exactly that key until `exp`. The API mints
 *   one only after checking the caller may see the key (call pieces, lesson-attempt audio, the MCP
 *   tools via POST /api/media/sign). Whoever holds the link can play it until it expires — so they
 *   are short (1 h for the apps, 24 h for MCP transcripts).
 * - A MEDIA TOKEN `?mt=<token>` names a user and an expiry (3 days). The web app appends it to
 *   `<audio src>` / `<img src>` of private keys (a media element can't send the Authorization
 *   header); every request is still authorised for that user (services/media-access.ts), so the
 *   token only ever opens what its user may see, and nothing else in the API accepts it.
 *
 * Neither is the session: signing out does not revoke them, they just expire.
 */

type SecretEnv = { SESSION_SECRET?: string; GOOGLE_CLIENT_SECRET?: string; E2E_TEST_MODE?: string };

const DEV_SECRET = 'dev-only-media-secret';
/** Signed links: default and ceiling of their lifetime. */
export const MEDIA_LINK_TTL_S = 3600;
export const MEDIA_LINK_MAX_TTL_S = 24 * 3600;
/** The user media token's lifetime; clients refresh it when less than a day is left. */
export const MEDIA_TOKEN_TTL_S = 3 * 24 * 3600;

const enc = new TextEncoder();

function secretFor(env: SecretEnv, purpose: 'media-link' | 'media-token'): string {
  if (env.SESSION_SECRET) return `${purpose}:${env.SESSION_SECRET}`;
  if (env.GOOGLE_CLIENT_SECRET) return `${purpose}:${env.GOOGLE_CLIENT_SECRET}`;
  if (env.E2E_TEST_MODE === 'true') return `${DEV_SECRET}:${purpose}`;
  throw new Error('SESSION_SECRET is not set');
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): string {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return atob(pad);
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The path of a key under /api/audio/ (each segment encoded; the server decodes it back). */
export function mediaPath(key: string): string {
  return `/api/audio/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** `/api/audio/<key>?exp=&sig=` — relative; prefix the API origin where an absolute URL is needed. */
export async function signMediaPath(env: SecretEnv, key: string, ttlS = MEDIA_LINK_TTL_S, nowMs = Date.now()): Promise<string> {
  const ttl = Math.max(60, Math.min(MEDIA_LINK_MAX_TTL_S, Math.floor(ttlS)));
  const exp = Math.floor(nowMs / 1000) + ttl;
  const sig = await hmac(secretFor(env, 'media-link'), `${key}\n${exp}`);
  return `${mediaPath(key)}?exp=${exp}&sig=${sig}`;
}

/** A link's signature is for this key and has not expired (nor is it dated further out than any link we mint). */
export async function verifyMediaSignature(
  env: SecretEnv,
  key: string,
  exp: string | undefined | null,
  sig: string | undefined | null,
  nowMs = Date.now(),
): Promise<boolean> {
  const e = Number(exp);
  if (!sig || !Number.isInteger(e)) return false;
  const nowS = Math.floor(nowMs / 1000);
  if (e < nowS || e > nowS + MEDIA_LINK_MAX_TTL_S + 60) return false;
  return sameString(await hmac(secretFor(env, 'media-link'), `${key}\n${e}`), sig);
}

export interface MediaToken {
  token: string;
  /** ISO time the token stops working. */
  expires_at: string;
}

export async function createMediaToken(env: SecretEnv, userId: string, nowMs = Date.now()): Promise<MediaToken> {
  const exp = Math.floor(nowMs / 1000) + MEDIA_TOKEN_TTL_S;
  const payload = b64url(enc.encode(`${userId}\n${exp}`));
  const sig = await hmac(secretFor(env, 'media-token'), payload);
  return { token: `${payload}.${sig}`, expires_at: new Date(exp * 1000).toISOString() };
}

/** The user a valid, unexpired media token belongs to, else null. */
export async function verifyMediaToken(env: SecretEnv, token: string | undefined | null, nowMs = Date.now()): Promise<string | null> {
  if (!token || token.length > 512) return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  if (!sameString(await hmac(secretFor(env, 'media-token'), payload), sig)) return null;
  try {
    const [userId, expRaw, more] = fromB64url(payload).split('\n');
    const exp = Number(expRaw);
    if (!userId || more !== undefined || !Number.isInteger(exp) || exp * 1000 <= nowMs) return null;
    if (exp * 1000 > nowMs + (MEDIA_TOKEN_TTL_S + 60) * 1000) return null;
    return userId;
  } catch {
    return null;
  }
}
