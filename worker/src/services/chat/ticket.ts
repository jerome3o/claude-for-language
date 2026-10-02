/**
 * One-minute HMAC tickets for WebSockets that cannot carry the session header
 * — the same scheme as the video-call join tickets (services/calls/ticket.ts),
 * generalised with a `purpose` that is part of the signed claims. A `live`
 * ticket (the user's ChatHub socket, docs/CHAT.md §2) is useless as a call
 * ticket and vice versa: the purposes are signed with differently derived keys
 * and the claims are checked.
 */

const TICKET_TTL_MS = 60_000;
const DEV_SECRET = 'dev-only-live-ticket-secret';

export type TicketPurpose = 'live';

export interface PurposeTicketClaims {
  purpose: TicketPurpose;
  userId: string;
  exp: number;
}

type TicketEnv = { SESSION_SECRET?: string; GOOGLE_CLIENT_SECRET?: string; E2E_TEST_MODE?: string };

function secretFor(env: TicketEnv, purpose: TicketPurpose): string {
  if (env.SESSION_SECRET) return `${purpose}-ticket:${env.SESSION_SECRET}`;
  if (env.GOOGLE_CLIENT_SECRET) return `${purpose}-ticket:${env.GOOGLE_CLIENT_SECRET}`;
  if (env.E2E_TEST_MODE === 'true') return `${DEV_SECRET}:${purpose}`;
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

export async function createPurposeTicket(env: TicketEnv, purpose: TicketPurpose, userId: string, now = Date.now()): Promise<string> {
  const claims: PurposeTicketClaims = { purpose, userId, exp: now + TICKET_TTL_MS };
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const sig = b64url(await hmac(secretFor(env, purpose), payload));
  return `${payload}.${sig}`;
}

/** The claims of a valid, unexpired ticket made for this purpose, else null. */
export async function verifyPurposeTicket(
  env: TicketEnv,
  ticket: string | null | undefined,
  purpose: TicketPurpose,
  now = Date.now(),
): Promise<PurposeTicketClaims | null> {
  if (!ticket || ticket.length > 1024) return null;
  const [payload, sig, extra] = ticket.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  const expected = b64url(await hmac(secretFor(env, purpose), payload));
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as PurposeTicketClaims;
    if (claims.purpose !== purpose || typeof claims.userId !== 'string' || !claims.userId || !(claims.exp > now)) return null;
    return claims;
  } catch {
    return null;
  }
}
