/**
 * Short-lived join tickets for the call room's WebSocket. Browsers cannot set
 * an Authorization header on a WebSocket, and a session token in a URL would
 * end up in logs, so the page asks POST /api/calls/:id/join (normal auth) for
 * a ticket valid for one minute, bound to the call and the user, and opens
 * the socket with ?ticket=.
 */

const TICKET_TTL_MS = 60_000;
const DEV_SECRET = 'dev-only-call-ticket-secret';

export interface TicketClaims {
  callId: string;
  userId: string;
  exp: number;
}

type TicketEnv = { SESSION_SECRET?: string; GOOGLE_CLIENT_SECRET?: string; E2E_TEST_MODE?: string };

/** SESSION_SECRET, else the Google OAuth secret (always set where sign-in works), else a dev key under E2E_TEST_MODE. */
function secretFor(env: TicketEnv): string {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (env.GOOGLE_CLIENT_SECRET) return `call-ticket:${env.GOOGLE_CLIENT_SECRET}`;
  if (env.E2E_TEST_MODE === 'true') return DEV_SECRET;
  throw new Error('SESSION_SECRET is not set');
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}

export async function createJoinTicket(
  env: TicketEnv,
  callId: string,
  userId: string,
  now = Date.now(),
): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ callId, userId, exp: now + TICKET_TTL_MS })));
  const sig = b64url(await hmac(secretFor(env), payload));
  return `${payload}.${sig}`;
}

/** The claims of a valid, unexpired ticket for this call, else null. */
export async function verifyJoinTicket(
  env: TicketEnv,
  ticket: string | null | undefined,
  callId: string,
  now = Date.now(),
): Promise<TicketClaims | null> {
  if (!ticket || ticket.length > 1024) return null;
  const [payload, sig] = ticket.split('.');
  if (!payload || !sig) return null;
  const expected = b64url(await hmac(secretFor(env), payload));
  // Constant-time-ish compare; both are short base64url strings.
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as TicketClaims;
    if (claims.callId !== callId || typeof claims.userId !== 'string' || !(claims.exp > now)) return null;
    return claims;
  } catch {
    return null;
  }
}
