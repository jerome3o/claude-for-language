/**
 * Serving R2 objects (docs/AUDIO.md "Private media", shared/media/access.ts):
 *
 *   GET  /api/audio/<key>   public generated content (TTS clips, pictures, avatars): anyone, cached a year.
 *                           person-made media (recordings, call audio, uploaded card photos, lesson-note
 *                           files): only with `?exp=&sig=` (a signed link for that key), `?mt=` (the
 *                           user's media token) or `Authorization: Bearer <session>`, and — for the last
 *                           two — only when that user may see it (services/media-access.ts). 401 without
 *                           a credential, 404 when not allowed. Every other key: 404 (served by its own
 *                           route, or by none). Cookies are NOT a credential here.
 *   GET  /api/media/token   → { token, expires_at }: the signed-in user's media token (3 days).
 *   POST /api/media/sign    { keys (≤ 100), ttl_s? (60…86400, default 3600) }
 *                           → { urls: { [key]: path | null } } — a signed path per key the caller may see
 *                           (public keys: the plain path; null = not theirs / not served). Used by the
 *                           MCP tools, which hand recordings to a chat transcript (24 h).
 *
 * Old app versions that fetch a private key anonymously now get 401 (docs/AUDIO.md "Old clients").
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { mediaAccessOf, mediaKeyOf, MEDIA_TOKEN_PARAM } from '@shared/media/access';
import { getAudio, parseByteRange, resolveServedRange } from '../services/audio';
import { getSessionWithUser } from '../services/auth';
import { canAccessMedia } from '../services/media-access';
import { applyStoredFileHeaders } from '../services/stored-file-headers';
import { allowedCorsOrigin } from '../services/cors-origins';
import { createMediaToken, mediaPath, signMediaPath, verifyMediaSignature, verifyMediaToken, MEDIA_LINK_MAX_TTL_S, MEDIA_LINK_TTL_S } from '../services/media-signing';

const notFound = (c: Context) => c.json({ error: 'Audio not found' }, 404);

/** Who is asking for a private key, from the media token or the Bearer session (never a cookie). */
async function requester(c: Context<{ Bindings: Env }>): Promise<string | null> {
  const mt = c.req.query(MEDIA_TOKEN_PARAM);
  const fromToken = mt ? await verifyMediaToken(c.env, mt) : null;
  if (fromToken) return fromToken;
  const auth = c.req.header('Authorization');
  if (auth?.startsWith('Bearer ')) {
    const session = await getSessionWithUser(c.env.DB, auth.slice(7)).catch(() => null);
    return session?.user.id ?? null;
  }
  return null;
}

export async function serveAudio(c: Context<{ Bindings: Env }>): Promise<Response> {
  const key = c.req.path.replace(/^\/api\/audio\//, '');
  const access = mediaAccessOf(key);
  if (access === 'none') return notFound(c);

  if (access === 'private') {
    const exp = c.req.query('exp');
    const sig = c.req.query('sig');
    if (exp || sig) {
      if (!(await verifyMediaSignature(c.env, key, exp, sig))) return c.json({ error: 'This link has expired' }, 403);
    } else {
      const userId = await requester(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);
      if (!(await canAccessMedia(c.env.DB, userId, key))) return notFound(c);
    }
  }

  // <audio> streams media with Range requests. Answering every one with the
  // full body (200) forces the element to re-buffer from zero whenever it
  // seeks or recovers from a stall, which on a weak connection sounds like the
  // clip cutting out. Serve real 206 partials instead.
  const range = parseByteRange(c.req.header('Range'));
  const object = await getAudio(c.env.AUDIO_BUCKET, key, range);
  if (!object) return notFound(c);

  // CORS: the apps' origins with credentials; anyone else may only read a public clip.
  const origin = allowedCorsOrigin(c.req.header('Origin'), c.env.CORS_EXTRA_ORIGINS);
  const headers = new Headers();
  // nosniff + sandbox; anything not audio / video / a raster picture downloads (services/stored-file-headers.ts).
  applyStoredFileHeaders(headers, { contentType: object.httpMetadata?.contentType, fallbackType: 'audio/mpeg' });
  // Public objects never change under a key (a new clip gets a new key); private ones stay in
  // the browser's own cache only — the apps keep their offline copies by R2 key, not by URL.
  headers.set('Cache-Control', access === 'public' ? 'public, max-age=31536000' : 'private, max-age=3600');
  headers.set('Accept-Ranges', 'bytes');
  if (access === 'private') headers.set('Referrer-Policy', 'no-referrer');
  if (object.httpEtag) headers.set('ETag', object.httpEtag);
  // Explicit CORS headers for audio element cross-origin playback
  headers.set('Access-Control-Allow-Origin', origin ?? '*');
  if (origin) {
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Vary', 'Origin');
  }
  // Range is not a CORS-safelisted response header, so the media element can
  // only see the partial-content headers if we expose them.
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, ETag');

  const served = range ? resolveServedRange(object.range, object.size) : null;
  if (served && served.length < object.size) {
    const { offset, length } = served;
    headers.set('Content-Length', String(length));
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    return new Response(object.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { headers });
}

/**
 * The path an authorised caller is handed for a key in a response: signed when the key is
 * private (the caller was checked by the route that loaded the row), plain otherwise.
 */
export async function mediaPathFor(env: Env, key: string | null | undefined, ttlS = MEDIA_LINK_TTL_S): Promise<string | null> {
  if (!key) return null;
  const k = mediaKeyOf(key);
  const access = mediaAccessOf(k);
  if (access === 'private') return signMediaPath(env, k, ttlS);
  return mediaPath(k);
}

const MAX_SIGN_KEYS = 100;

export const mediaRoutes = new Hono<{ Bindings: Env }>();

mediaRoutes.get('/media/token', async (c) => {
  const token = await createMediaToken(c.env, c.get('user').id);
  return c.json(token, 200, { 'Cache-Control': 'no-store' });
});

mediaRoutes.post('/media/sign', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json<{ keys?: unknown; ttl_s?: unknown }>().catch(() => ({}) as { keys?: unknown; ttl_s?: unknown });
  if (!Array.isArray(body.keys) || body.keys.some((k) => typeof k !== 'string')) return c.json({ error: 'keys must be a list of strings' }, 400);
  if (body.keys.length > MAX_SIGN_KEYS) return c.json({ error: `At most ${MAX_SIGN_KEYS} keys` }, 400);
  const ttl = typeof body.ttl_s === 'number' && Number.isFinite(body.ttl_s) ? Math.min(MEDIA_LINK_MAX_TTL_S, Math.max(60, body.ttl_s)) : MEDIA_LINK_TTL_S;
  const urls: Record<string, string | null> = {};
  for (const raw of [...new Set(body.keys as string[])]) {
    const key = mediaKeyOf(raw);
    const access = mediaAccessOf(key);
    if (access === 'public') urls[raw] = mediaPath(key);
    else if (access === 'private' && (await canAccessMedia(c.env.DB, userId, key))) urls[raw] = await signMediaPath(c.env, key, ttl);
    else urls[raw] = null;
  }
  return c.json({ urls, expires_in_s: ttl }, 200, { 'Cache-Control': 'no-store' });
});
