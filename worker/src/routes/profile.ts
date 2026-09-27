/**
 * The signed-in user's editable profile. Mounted under /api in index.ts after
 * the auth middleware, so c.get('user') is always set here.
 *
 *   GET    /profile           the profile (name, picture + where it comes from, Google's values, bio, about, time zone)
 *   PUT    /profile           { name?, bio?, about?, time_zone? } — validated (shared/profile), 400 + problems; name null = back to Google's
 *   POST   /profile/picture   an image (raw body or multipart field `picture`) — JPEG / PNG / WebP ≤ 2 MB, stored in R2
 *   DELETE /profile/picture   ?use=google (default: back to the Google photo) | none (no photo)
 *
 * Name and picture edits land in users.name / users.picture_url, which every
 * other screen already reads; the Google sign-in no longer overwrites them
 * once edited (services/profile.ts googleProfileRefresh).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { pickProfileUpdate, PROFILE_PICTURE_MAX_BYTES } from '@shared/profile';
import {
  clearPicture,
  getProfile,
  pictureProblems,
  readPictureBytes,
  setUploadedPicture,
  updateProfile,
} from '../services/profile';

const profile = new Hono<{ Bindings: Env }>();

profile.get('/profile', async (c) => {
  const p = await getProfile(c.env.DB, c.get('user').id);
  if (!p) return c.json({ error: 'Not found' }, 404);
  return c.json(p);
});

profile.put('/profile', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Send a JSON object', problems: ['Send a JSON object'] }, 400);
  }
  const { update, problems } = pickProfileUpdate(body);
  if (problems.length) return c.json({ error: problems.join('; '), problems }, 400);
  const p = await updateProfile(c.env.DB, c.get('user').id, update);
  return c.json(p);
});

profile.post('/profile/picture', async (c) => {
  const declared = Number(c.req.header('Content-Length') || 0);
  // Multipart adds a little framing around the image.
  if (declared > PROFILE_PICTURE_MAX_BYTES + 64 * 1024) {
    const problems = pictureProblems(new Uint8Array(PROFILE_PICTURE_MAX_BYTES + 1));
    return c.json({ error: problems[0], problems }, 400);
  }
  let bytes: Uint8Array | null;
  try {
    bytes = await readPictureBytes(c.req.raw);
  } catch {
    bytes = null;
  }
  const problems = pictureProblems(bytes);
  if (problems.length) return c.json({ error: problems[0], problems }, 400);
  const origin = new URL(c.req.url).origin;
  const p = await setUploadedPicture(c.env.DB, c.env.AUDIO_BUCKET, c.get('user').id, bytes!, origin);
  return c.json(p);
});

profile.delete('/profile/picture', async (c) => {
  const use = c.req.query('use') === 'none' ? 'none' : 'google';
  const p = await clearPicture(c.env.DB, c.env.AUDIO_BUCKET, c.get('user').id, use);
  return c.json(p);
});

export default profile;
