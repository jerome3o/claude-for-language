/**
 * Pictures on cards (services/note-images.ts, shared/cards/note-image.ts). Mounted under /api after
 * the auth middleware; every route works on the caller's own notes / decks only (404 otherwise).
 *
 *   GET    /notes/:id/image            → { note: NoteImageView } (the apps poll it while a picture is drawn)
 *   POST   /notes/:id/image/generate   { regenerate? } → { note: NoteImageView } (202 while it is being drawn)
 *   PUT    /notes/:id/image            raw JPEG / PNG / WebP body (or multipart `picture`), ≤ 3 MB → { note }
 *   DELETE /notes/:id/image            → { note }
 *   GET    /decks/:id/illustrate       → DeckIllustrateStatus (counts, estimate, illustrate_new, available)
 *   POST   /decks/:id/illustrate       { limit? } → { ready, pending, queued, status } (202)
 *   PUT    /decks/:id/illustrate       { illustrate_new: boolean } → { illustrate_new }
 *
 * 503 when no image generator is configured (uploads still work).
 */
import { Hono } from 'hono';
import { NOTE_IMAGE_MAX_BYTES } from '@shared/cards/note-image';
import type { Env } from '../types';
import { ContentError } from '../services/content/decks';
import {
  deckIllustrateStatus,
  getOwnedNoteImageView,
  illustrateDeck,
  NoteImagesUnavailableError,
  removeNoteImage,
  requestNoteImage,
  setDeckIllustrateNew,
  setUploadedNoteImage,
} from '../services/note-images';
import { readPictureBytes } from '../services/profile';

const routes = new Hono<{ Bindings: Env }>();

function failure(err: unknown) {
  if (err instanceof NoteImagesUnavailableError) return { body: { error: err.message, retryable: false }, status: 503 as const };
  if (err instanceof ContentError) return { body: { error: err.message }, status: err.status };
  throw err;
}

routes.get('/notes/:id/image', async (c) => {
  const note = await getOwnedNoteImageView(c.env, c.get('user').id, c.req.param('id'));
  if (!note) return c.json({ error: 'Note not found' }, 404);
  return c.json({ note });
});

routes.post('/notes/:id/image/generate', async (c) => {
  const body = await c.req.json<{ regenerate?: boolean }>().catch(() => ({} as { regenerate?: boolean }));
  try {
    const note = await requestNoteImage(c.env, c.get('user').id, c.req.param('id'), { regenerate: body?.regenerate === true });
    if (!note) return c.json({ error: 'Note not found' }, 404);
    return c.json({ note }, note.image_status === 'pending' ? 202 : 200);
  } catch (err) {
    const f = failure(err);
    return c.json(f.body, f.status);
  }
});

routes.put('/notes/:id/image', async (c) => {
  const declared = Number(c.req.header('Content-Length') || 0);
  if (declared > NOTE_IMAGE_MAX_BYTES + 64 * 1024) {
    return c.json({ error: `The picture must be at most ${NOTE_IMAGE_MAX_BYTES / 1024 / 1024} MB` }, 400);
  }
  let bytes: Uint8Array | null;
  try {
    bytes = await readPictureBytes(c.req.raw);
  } catch {
    bytes = null;
  }
  try {
    const note = await setUploadedNoteImage(c.env, c.get('user').id, c.req.param('id'), bytes ?? new Uint8Array());
    if (!note) return c.json({ error: 'Note not found' }, 404);
    return c.json({ note });
  } catch (err) {
    const f = failure(err);
    return c.json(f.body, f.status);
  }
});

routes.delete('/notes/:id/image', async (c) => {
  const note = await removeNoteImage(c.env, c.get('user').id, c.req.param('id'));
  if (!note) return c.json({ error: 'Note not found' }, 404);
  return c.json({ note });
});

routes.get('/decks/:id/illustrate', async (c) => {
  const status = await deckIllustrateStatus(c.env, c.get('user').id, c.req.param('id'));
  if (!status) return c.json({ error: 'Deck not found' }, 404);
  return c.json(status);
});

routes.post('/decks/:id/illustrate', async (c) => {
  const body = await c.req.json<{ limit?: number }>().catch(() => ({} as { limit?: number }));
  try {
    const res = await illustrateDeck(c.env, c.get('user').id, c.req.param('id'), typeof body?.limit === 'number' ? body.limit : undefined);
    if (!res) return c.json({ error: 'Deck not found' }, 404);
    return c.json(res, 202);
  } catch (err) {
    const f = failure(err);
    return c.json(f.body, f.status);
  }
});

routes.put('/decks/:id/illustrate', async (c) => {
  const body = await c.req.json<{ illustrate_new?: unknown }>().catch(() => null);
  if (!body || typeof body.illustrate_new !== 'boolean') return c.json({ error: 'illustrate_new must be true or false' }, 400);
  const on = await setDeckIllustrateNew(c.env.DB, c.get('user').id, c.req.param('id'), body.illustrate_new);
  if (on === null) return c.json({ error: 'Deck not found' }, 404);
  return c.json({ illustrate_new: on });
});

export default routes;
