/**
 * The signed link Soniox fetches an episode's audio from (docs/PODCASTS.md): our R2 copy is
 * private, so the transcription request carries `…/api/podcast-source/<episode>?exp=&sig=`, an
 * HMAC-SHA256 (key derived from SESSION_SECRET) over the episode id and the expiry. The link
 * only serves that one episode's audio and stops working after a few hours.
 */

const enc = new TextEncoder();
export const SOURCE_LINK_TTL_S = 6 * 3600;

function b64url(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(`podcast-source:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function signSource(secret: string, episodeId: string, exp: number): Promise<string> {
  return b64url(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(`${episodeId}.${exp}`)));
}

/** The full link (origin = this worker's public origin). */
export async function sourceUrl(secret: string, origin: string, episodeId: string, nowMs = Date.now()): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + SOURCE_LINK_TTL_S;
  const sig = await signSource(secret, episodeId, exp);
  return `${origin.replace(/\/+$/, '')}/api/podcast-source/${encodeURIComponent(episodeId)}?exp=${exp}&sig=${sig}`;
}

/** Constant-time check of a link's signature and expiry. */
export async function verifySource(secret: string, episodeId: string, exp: string | undefined, sig: string | undefined, nowMs = Date.now()): Promise<boolean> {
  const e = Number(exp);
  if (!sig || !Number.isInteger(e) || e * 1000 < nowMs || e * 1000 > nowMs + 2 * SOURCE_LINK_TTL_S * 1000) return false;
  const want = await signSource(secret, episodeId, e);
  if (want.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
