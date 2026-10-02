/**
 * Firebase Cloud Messaging (HTTP v1) — instant chat notifications for the
 * native Lab app (docs/CHAT.md §3).
 *
 * Credentials: the FCM_SERVICE_ACCOUNT_JSON secret holds the whole Firebase
 * service-account JSON (project_id, client_email, private_key PEM). The worker
 * signs an RS256 JWT with WebCrypto, exchanges it at Google's token endpoint
 * for an OAuth2 access token (scope firebase.messaging) and keeps that token
 * per isolate until ~5 minutes before it expires.
 *
 * Messages are data-only and high priority: the app builds the notification
 * itself (MessagingStyle, Reply / Mark as read actions).
 */

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Refresh the access token this long before Google says it expires. */
const REFRESH_MARGIN_MS = 5 * 60_000;

export interface FcmServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

type FcmEnv = { FCM_SERVICE_ACCOUNT_JSON?: string };

/** The service account in the secret, or null when it is unset / unusable. */
export function parseServiceAccount(json: string | undefined | null): FcmServiceAccount | null {
  if (!json || !json.trim()) return null;
  try {
    const raw = JSON.parse(json) as Partial<FcmServiceAccount>;
    if (typeof raw.project_id !== 'string' || !raw.project_id) return null;
    if (typeof raw.client_email !== 'string' || !raw.client_email) return null;
    if (typeof raw.private_key !== 'string' || !raw.private_key.includes('PRIVATE KEY')) return null;
    return {
      project_id: raw.project_id,
      client_email: raw.client_email,
      // A key pasted with literal "\n" sequences still works.
      private_key: raw.private_key.replace(/\\n/g, '\n'),
      ...(typeof raw.token_uri === 'string' && raw.token_uri.startsWith('https://') ? { token_uri: raw.token_uri } : {}),
    };
  } catch {
    return null;
  }
}

/** True when the worker has usable FCM credentials (GET /api/push/config → `fcm`). */
export function fcmConfigured(env: FcmEnv): boolean {
  return parseServiceAccount(env.FCM_SERVICE_ACCOUNT_JSON) !== null;
}

// ---------- JWT (RS256) ----------

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '')
    .replace(/-----END [A-Z ]*PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function signingKey(pem: string): Promise<CryptoKey> {
  let key = keyCache.get(pem);
  if (!key) {
    key = crypto.subtle.importKey('pkcs8', pemToPkcs8(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    key.catch(() => keyCache.delete(pem));
    keyCache.set(pem, key);
  }
  return key;
}

/** The signed assertion exchanged for an access token (exported for tests). */
export async function signServiceAccountJwt(sa: FcmServiceAccount, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = b64urlJson({ alg: 'RS256', typ: 'JWT' });
  const claims = b64urlJson({
    iss: sa.client_email,
    sub: sa.client_email,
    scope: FCM_SCOPE,
    aud: sa.token_uri || TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  });
  const input = `${header}.${claims}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey(sa.private_key), new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

// ---------- Access token (cached per isolate) ----------

let tokenCache: { email: string; token: string; expiresAt: number } | null = null;

/** Forget the cached access token (tests; a 401 from FCM). */
export function resetFcmTokenCache(): void {
  tokenCache = null;
}

export async function getFcmAccessToken(sa: FcmServiceAccount, fetcher: typeof fetch = fetch, now = Date.now()): Promise<string> {
  if (tokenCache && tokenCache.email === sa.client_email && tokenCache.expiresAt - REFRESH_MARGIN_MS > now) {
    return tokenCache.token;
  }
  const assertion = await signServiceAccountJwt(sa, Math.floor(now / 1000));
  const res = await fetcher(sa.token_uri || TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`FCM token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  const body = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('FCM token exchange returned no access_token');
  tokenCache = { email: sa.client_email, token: body.access_token, expiresAt: now + (Number(body.expires_in) || 3600) * 1000 };
  return body.access_token;
}

// ---------- Sending ----------

export interface FcmSendOptions {
  /** Messages with the same key replace each other while the device is offline (the conversation id). */
  collapseKey?: string;
  /** Seconds FCM keeps the message for an offline device (default 86400). */
  ttlSeconds?: number;
}

export interface FcmResult {
  ok: boolean;
  status: number;
  /** The token is dead (uninstalled / invalid / another sender's): delete it. */
  gone: boolean;
  error?: string;
}

/** FCM data values must all be strings; null / undefined fields are left out. */
export function toFcmData(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  return out;
}

/** Whether an FCM error answer means "this registration token is no good". */
export function isGoneTokenError(status: number, body: string): boolean {
  if (status === 404) return true;
  if (/UNREGISTERED|SENDER_ID_MISMATCH/.test(body)) return true;
  if (status === 400 && /INVALID_ARGUMENT/.test(body) && /token/i.test(extractMessage(body))) return true;
  return false;
}

function extractMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return parsed.error?.message ?? body;
  } catch {
    return body;
  }
}

/** One data message to one device. Never throws (network / credential failures come back as `ok: false`). */
export async function sendFcm(
  env: FcmEnv,
  token: string,
  data: Record<string, unknown>,
  opts: FcmSendOptions = {},
  fetcher: typeof fetch = fetch,
): Promise<FcmResult> {
  const sa = parseServiceAccount(env.FCM_SERVICE_ACCOUNT_JSON);
  if (!sa) return { ok: false, status: 0, gone: false, error: 'FCM is not configured' };
  const message = {
    message: {
      token,
      data: toFcmData(data),
      android: {
        priority: 'HIGH',
        ttl: `${Math.max(0, Math.floor(opts.ttlSeconds ?? 86400))}s`,
        ...(opts.collapseKey ? { collapse_key: opts.collapseKey } : {}),
      },
    },
  };
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const accessToken = await getFcmAccessToken(sa, fetcher);
      const res = await fetcher(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });
      if (res.ok) return { ok: true, status: res.status, gone: false };
      const body = await res.text().catch(() => '');
      // A revoked / expired access token: fetch a fresh one and try once more.
      if (res.status === 401 && attempt === 0) {
        resetFcmTokenCache();
        continue;
      }
      return { ok: false, status: res.status, gone: isGoneTokenError(res.status, body), error: extractMessage(body).slice(0, 300) };
    }
    return { ok: false, status: 401, gone: false, error: 'FCM rejected the access token' };
  } catch (err) {
    return { ok: false, status: 0, gone: false, error: err instanceof Error ? err.message : String(err) };
  }
}
