/**
 * Picture hunts on the device: finished hunts are cached whole in IndexedDB
 * (objects + the picture's bytes) so they play offline, and plays are recorded
 * locally first and uploaded idempotently (by play id) — right away when
 * online, else by the next sync.
 */
import type { PictureHunt, PictureHuntPlay, PictureHuntSummary } from '@shared/picture-hunt';
import { db, type LocalPictureHunt } from '../db/database';
import * as api from '../api/pictureHunts';

const REFRESH_KEY = 'picture-hunts-refreshed-at';
const REFRESH_EVERY_MS = 10 * 60 * 1000;
const LONG_SIDE = 1600;

export async function getLocalHunts(): Promise<LocalPictureHunt[]> {
  const rows = await db.pictureHunts.toArray();
  return rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function getLocalHunt(id: string): Promise<LocalPictureHunt | undefined> {
  return db.pictureHunts.get(id);
}

/** Store the server's list: keep cached objects of unchanged hunts, drop hunts deleted elsewhere. */
export async function storeHuntList(hunts: PictureHuntSummary[]): Promise<void> {
  const existing = new Map((await db.pictureHunts.toArray()).map((h) => [h.id, h]));
  const ids = new Set(hunts.map((h) => h.id));
  await db.transaction('rw', db.pictureHunts, db.pictureHuntImages, async () => {
    for (const hunt of hunts) {
      const prev = existing.get(hunt.id);
      const keepObjects = prev?.objects && prev.updated_at === hunt.updated_at && hunt.status === 'ready';
      await db.pictureHunts.put({ ...hunt, ...(keepObjects ? { objects: prev!.objects } : {}) });
    }
    for (const id of existing.keys()) {
      if (!ids.has(id)) {
        await db.pictureHunts.delete(id);
        await db.pictureHuntImages.delete(id);
      }
    }
  });
}

export async function storeHunt(hunt: PictureHunt): Promise<void> {
  await db.pictureHunts.put(hunt);
}

/** The picture: cached bytes, else fetched (and cached) when online; null offline with nothing cached. */
export async function getHuntImage(id: string): Promise<Blob | null> {
  const cached = await db.pictureHuntImages.get(id);
  if (cached) return cached.blob;
  if (!navigator.onLine) return null;
  try {
    const blob = await api.fetchPictureHuntImage(id);
    await db.pictureHuntImages.put({ id, blob, cached_at: Date.now() });
    return blob;
  } catch {
    return null;
  }
}

/** A ready hunt with objects: the cached copy, refreshed from the server when online. */
export async function loadHunt(id: string): Promise<LocalPictureHunt | null> {
  const local = await getLocalHunt(id);
  if (navigator.onLine && (!local?.objects || local.status !== 'ready')) {
    try {
      const { hunt } = await api.getPictureHunt(id);
      await storeHunt(hunt);
      return hunt;
    } catch (err) {
      if (!local) throw err;
    }
  }
  return local ?? null;
}

/** Fetch the list, then objects and pictures of ready hunts not yet on the device. */
export async function refreshPictureHunts(): Promise<LocalPictureHunt[]> {
  const { hunts } = await api.listPictureHunts();
  await storeHuntList(hunts);
  for (const summary of hunts) {
    if (summary.status !== 'ready') continue;
    const local = await db.pictureHunts.get(summary.id);
    if (!local?.objects) {
      try {
        const { hunt } = await api.getPictureHunt(summary.id);
        await storeHunt(hunt);
      } catch (err) {
        console.warn('[pictureHunts] could not cache hunt', summary.id, err);
      }
    }
    if (!(await db.pictureHuntImages.get(summary.id))) await getHuntImage(summary.id);
  }
  try {
    localStorage.setItem(REFRESH_KEY, String(Date.now()));
  } catch { /* private mode */ }
  return getLocalHunts();
}

/** Record a finished play on the device and try to upload it now. */
export async function recordHuntPlay(play: PictureHuntPlay): Promise<void> {
  await db.pictureHuntPlays.put({ ...play, _synced: 0 });
  // Reflect it locally at once (best / count), the server's numbers replace these on upload.
  const hunt = await db.pictureHunts.get(play.hunt_id);
  if (hunt) {
    await db.pictureHunts.put({
      ...hunt,
      best_found: Math.max(hunt.best_found ?? 0, play.found_ids.length),
      play_count: hunt.play_count + 1,
      last_played_at: play.played_at,
    });
  }
  if (navigator.onLine) await uploadPendingHuntPlays().catch(() => {});
}

export async function uploadPendingHuntPlays(): Promise<number> {
  const pending = await db.pictureHuntPlays.where('_synced').equals(0).toArray();
  if (pending.length === 0) return 0;
  let uploaded = 0;
  for (let i = 0; i < pending.length; i += 100) {
    const batch = pending.slice(i, i + 100).map(({ _synced: _s, ...play }) => play);
    const result = await api.uploadPictureHuntPlays(batch);
    await db.transaction('rw', db.pictureHuntPlays, db.pictureHunts, async () => {
      for (const id of result.stored) await db.pictureHuntPlays.update(id, { _synced: 1 });
      for (const id of result.rejected) await db.pictureHuntPlays.update(id, { _synced: -1 });
      for (const summary of result.hunts) {
        const local = await db.pictureHunts.get(summary.id);
        if (local) await db.pictureHunts.put({ ...local, best_found: summary.best_found, play_count: summary.play_count, last_played_at: summary.last_played_at });
      }
    });
    uploaded += result.stored.length;
  }
  return uploaded;
}

/** The sync's step: plays up every time, the hunt cache refreshed at most every 10 minutes. */
export async function syncPictureHunts(): Promise<void> {
  await uploadPendingHuntPlays();
  let last = 0;
  try {
    last = Number(localStorage.getItem(REFRESH_KEY) || 0);
  } catch { /* private mode */ }
  if (Date.now() - last > REFRESH_EVERY_MS) await refreshPictureHunts();
}

/**
 * A photo ready to upload: at most 1600px on the long side, re-encoded as a
 * JPEG. Re-encoding through a canvas drops EXIF (incl. GPS); the browser
 * applies the EXIF orientation when it decodes the file.
 */
export async function preparePhoto(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('This photo couldn\'t be opened. Try a JPEG or PNG.'));
      el.src = url;
    });
    const scale = Math.min(1, LONG_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Your browser can\'t resize photos');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Couldn\'t prepare the photo'))), 'image/jpeg', 0.85);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function deleteHuntEverywhere(id: string): Promise<void> {
  await api.deletePictureHunt(id);
  await db.transaction('rw', db.pictureHunts, db.pictureHuntImages, db.pictureHuntPlays, async () => {
    await db.pictureHunts.delete(id);
    await db.pictureHuntImages.delete(id);
    await db.pictureHuntPlays.where('hunt_id').equals(id).delete();
  });
}
