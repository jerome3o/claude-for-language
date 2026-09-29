/**
 * Picture hunts (看图找词) — services/picture-hunt.ts builds them on
 * picture-hunt-queue. Mounted under /api after the auth middleware; every
 * route is scoped to the caller's own hunts.
 *
 *   GET    /picture-hunts               { hunts: PictureHuntSummary[] } newest first (stale builds marked failed)
 *   POST   /picture-hunts               { prompt, deck_ids?, use_learning_words? } → 202 { hunt } (a generated picture)
 *   POST   /picture-hunts/upload        raw JPEG/PNG/WebP body (or multipart `picture`), ?caption= → 202 { hunt }
 *   GET    /picture-hunts/:id           { hunt: PictureHunt } with objects
 *   GET    /picture-hunts/:id/image     the picture's bytes (owner only)
 *   POST   /picture-hunts/:id/retry     rebuild a failed hunt (keeps an existing picture)
 *   DELETE /picture-hunts/:id           the hunt, its plays and its picture
 *   POST   /picture-hunts/plays         { plays: PictureHuntPlay[] } → { accepted, hunts } (idempotent by play id)
 */
import { Hono } from 'hono';
import { sanitizeHuntPlay } from '@shared/picture-hunt';
import type { PictureHuntPlay } from '@shared/picture-hunt';
import type { Env } from '../types';
import * as huntDb from '../db/picture-hunt-queries';
import { readPictureBytes } from '../services/profile';
import { extFor, sniffImage } from '../services/picture-hunt';

export const PICTURE_HUNT_UPLOAD_MAX_BYTES = 6 * 1024 * 1024;
const MAX_PROMPT = 300;
const MAX_PLAYS_PER_CALL = 100;

const routes = new Hono<{ Bindings: Env }>();

function userId(c: { get: (k: 'user') => { id: string } | undefined }): string | null {
  return c.get('user')?.id ?? null;
}

function keysMissing(env: Env): string | null {
  if (!env.GEMINI_API_KEY) return 'Picture hunts need the Gemini key, which is not configured on the server';
  if (!env.ANTHROPIC_API_KEY) return 'Picture hunts need the Claude key, which is not configured on the server';
  return null;
}

/**
 * JPEG with the metadata segments (EXIF incl. GPS, XMP, comments) taken out.
 * The apps already re-encode photos without them; this is the server's belt
 * and braces. Other formats pass through unchanged.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let o = 2;
  while (o + 4 <= bytes.length) {
    if (bytes[o] !== 0xff) return bytes; // not a clean marker stream: leave it alone
    const marker = bytes[o + 1];
    if (marker === 0xda) {
      parts.push(bytes.subarray(o));
      break;
    }
    const len = (bytes[o + 2] << 8) | bytes[o + 3];
    const segment = bytes.subarray(o, o + 2 + len);
    // APP1 (EXIF / XMP), APP2–APP15 except APP14 (Adobe colour), COM
    const drop = (marker >= 0xe1 && marker <= 0xef && marker !== 0xee) || marker === 0xfe;
    if (!drop) parts.push(segment);
    o += 2 + len;
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

routes.get('/picture-hunts', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  await huntDb.markStalePictureHunts(c.env.DB, uid);
  const rows = await huntDb.listPictureHunts(c.env.DB, uid);
  return c.json({ hunts: rows.map(huntDb.huntSummary) });
});

routes.post('/picture-hunts', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const missing = keysMissing(c.env);
  if (missing) return c.json({ error: missing }, 503);
  const body = await c.req.json<{ prompt?: unknown; deck_ids?: unknown; use_learning_words?: unknown }>().catch(() => ({} as Record<string, unknown>));
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, MAX_PROMPT) : '';
  if (!prompt) return c.json({ error: 'Say what the picture should show, e.g. "a busy kitchen"' }, 400);
  const deckIds = Array.isArray(body.deck_ids) ? body.deck_ids.filter((d): d is string => typeof d === 'string').slice(0, 50) : [];
  // Lean toward the learner's words unless told not to: specific decks, or all of them ([] = every deck).
  const useWords = body.use_learning_words !== false;
  const id = await huntDb.createPictureHunt(c.env.DB, {
    userId: uid,
    title: prompt.slice(0, 80),
    source: 'generated',
    prompt,
    deckIds: useWords ? deckIds : null,
  });
  await c.env.PICTURE_HUNT_QUEUE.send({ huntId: id });
  const row = await huntDb.getPictureHunt(c.env.DB, id, uid);
  return c.json({ hunt: huntDb.huntSummary(row!) }, 202);
});

routes.post('/picture-hunts/upload', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const missing = keysMissing(c.env);
  if (missing) return c.json({ error: missing }, 503);
  const declared = Number(c.req.header('Content-Length') || 0);
  if (declared > PICTURE_HUNT_UPLOAD_MAX_BYTES + 64 * 1024) return c.json({ error: 'That photo is too big (6 MB at most)' }, 413);
  let bytes: Uint8Array | null = null;
  try {
    bytes = await readPictureBytes(c.req.raw);
  } catch {
    bytes = null;
  }
  if (!bytes || bytes.length === 0) return c.json({ error: 'No photo was sent' }, 400);
  if (bytes.length > PICTURE_HUNT_UPLOAD_MAX_BYTES) return c.json({ error: 'That photo is too big (6 MB at most)' }, 413);
  const sniffed = sniffImage(bytes);
  if (!sniffed) return c.json({ error: 'Send a JPEG, PNG or WebP photo' }, 400);
  const clean = sniffed.mime === 'image/jpeg' ? stripJpegMetadata(bytes) : bytes;
  const caption = (c.req.query('caption') || '').trim().slice(0, MAX_PROMPT);

  const id = crypto.randomUUID();
  const key = huntDb.pictureHuntImageKey(id, extFor(sniffed.mime));
  await c.env.AUDIO_BUCKET.put(key, clean, { httpMetadata: { contentType: sniffed.mime } });
  await huntDb.createPictureHunt(c.env.DB, { id, userId: uid, title: caption || 'My photo', source: 'upload', prompt: caption || null, deckIds: [] });
  await huntDb.setPictureHuntImage(c.env.DB, id, key, sniffed.width || null, sniffed.height || null);
  await c.env.PICTURE_HUNT_QUEUE.send({ huntId: id });
  const row = await huntDb.getPictureHunt(c.env.DB, id, uid);
  return c.json({ hunt: huntDb.huntSummary(row!) }, 202);
});

routes.post('/picture-hunts/plays', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.json<{ plays?: unknown }>().catch(() => ({} as { plays?: unknown }));
  if (!Array.isArray(body.plays)) return c.json({ error: 'plays is required' }, 400);
  if (body.plays.length > MAX_PLAYS_PER_CALL) return c.json({ error: `At most ${MAX_PLAYS_PER_CALL} plays per call` }, 400);
  const huntIds = Array.from(new Set(body.plays
    .map((p) => (p && typeof p === 'object' ? (p as { hunt_id?: unknown }).hunt_id : null))
    .filter((h): h is string => typeof h === 'string')));
  const owned = await huntDb.ownedHuntObjectIds(c.env.DB, uid, huntIds);
  const plays: PictureHuntPlay[] = [];
  const rejected: string[] = [];
  for (const raw of body.plays) {
    const huntId = raw && typeof raw === 'object' ? (raw as { hunt_id?: unknown }).hunt_id : null;
    const ids = typeof huntId === 'string' ? owned.get(huntId) : undefined;
    const play = ids ? sanitizeHuntPlay(raw, ids) : null;
    if (play) plays.push(play);
    else if (raw && typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'string') rejected.push((raw as { id: string }).id);
  }
  const accepted = await huntDb.recordPictureHuntPlays(c.env.DB, uid, plays);
  const hunts = [];
  for (const id of owned.keys()) {
    const row = await huntDb.getPictureHunt(c.env.DB, id, uid);
    if (row) hunts.push(huntDb.huntSummary(row));
  }
  // `rejected`: plays for hunts that no longer exist (deleted) — the client drops them.
  return c.json({ accepted, stored: plays.map((p) => p.id), rejected, hunts });
});

routes.get('/picture-hunts/:id', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  await huntDb.markStalePictureHunts(c.env.DB, uid);
  const row = await huntDb.getPictureHunt(c.env.DB, c.req.param('id'), uid);
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json({ hunt: huntDb.huntWithObjects(row) });
});

routes.get('/picture-hunts/:id/image', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const row = await huntDb.getPictureHunt(c.env.DB, c.req.param('id'), uid);
  if (!row?.image_key) return c.json({ error: 'Not found' }, 404);
  const obj = await c.env.AUDIO_BUCKET.get(row.image_key);
  if (!obj) return c.json({ error: 'Not found' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
      // The picture never changes for a given key; private because it may be a personal photo.
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
});

routes.post('/picture-hunts/:id/retry', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const row = await huntDb.getPictureHunt(c.env.DB, c.req.param('id'), uid);
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.status === 'ready') return c.json({ error: 'This hunt is already built' }, 409);
  const missing = keysMissing(c.env);
  if (missing) return c.json({ error: missing }, 503);
  await huntDb.resetPictureHuntForRetry(c.env.DB, row.id, uid);
  await c.env.PICTURE_HUNT_QUEUE.send({ huntId: row.id });
  const fresh = await huntDb.getPictureHunt(c.env.DB, row.id, uid);
  return c.json({ hunt: huntDb.huntSummary(fresh!) }, 202);
});

routes.delete('/picture-hunts/:id', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const row = await huntDb.getPictureHunt(c.env.DB, c.req.param('id'), uid);
  if (!row) return c.json({ ok: true });
  await huntDb.deletePictureHunt(c.env.DB, row.id, uid);
  if (row.image_key) await c.env.AUDIO_BUCKET.delete(row.image_key).catch(() => {});
  return c.json({ ok: true });
});

export default routes;
