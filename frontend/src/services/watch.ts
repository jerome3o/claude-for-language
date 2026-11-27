/**
 * 📺 Watch on the device (docs/WATCH.md). The list and every opened transcript are kept in their
 * OWN small IndexedDB database (`watch` — separate from ChineseLearningDB, so no schema bump and the
 * study sync never sees it), so both read offline; the video itself always needs a connection (it is
 * YouTube's player — nothing of YouTube's is stored). The resume position is saved on the device at
 * once and sent to the server when possible. Player switches (拼, EN, speed, pause after each line,
 * listen first) are per device in localStorage.
 */
import Dexie, { type Table } from 'dexie';
import { parseWatchSpeed, type WatchVideoDetail, type WatchVideoSummary } from '@shared/watch';
import { getWatchVideo, listWatchVideos, saveWatchPosition } from '../api/watch';

interface StoredVideo {
  id: string;
  video: WatchVideoDetail;
  cached_at: number;
}

interface StoredList {
  id: 'mine';
  videos: WatchVideoSummary[];
  available: boolean;
}

interface StoredPosition {
  id: string;
  position_ms: number;
  at: number;
  /** Not yet on the server. */
  pending: 0 | 1;
}

class WatchDB extends Dexie {
  videos!: Table<StoredVideo, string>;
  lists!: Table<StoredList, string>;
  positions!: Table<StoredPosition, string>;
  constructor() {
    super('watch');
    this.version(1).stores({ videos: 'id', lists: 'id', positions: 'id, pending' });
  }
}

let db: WatchDB | null = null;
function getDb(): WatchDB | null {
  if (db) return db;
  try {
    db = new WatchDB();
    return db;
  } catch {
    return null;
  }
}

// ---------------- list

export async function cachedWatchList(): Promise<StoredList | null> {
  return (await getDb()?.lists.get('mine').catch(() => undefined)) ?? null;
}

/** My videos from the server (kept on the device), with this device's newer positions folded in. */
export async function refreshWatchList(): Promise<StoredList> {
  const fresh = await listWatchVideos();
  const row: StoredList = { id: 'mine', videos: fresh.videos, available: fresh.available };
  await getDb()?.lists.put(row).catch(() => undefined);
  return withLocalPositions(row);
}

export async function withLocalPositions(list: StoredList): Promise<StoredList> {
  const positions = (await getDb()?.positions.toArray().catch(() => [])) ?? [];
  if (!positions.length) return list;
  const map = new Map(positions.map((p) => [p.id, p]));
  return {
    ...list,
    videos: list.videos.map((v) => {
      const p = map.get(v.id);
      return p && p.pending ? { ...v, position_ms: p.position_ms } : v;
    }),
  };
}

/** Drop a video from the device's list at once (the server call is the caller's). */
export async function forgetWatchVideo(id: string): Promise<void> {
  const store = getDb();
  if (!store) return;
  const list = await store.lists.get('mine').catch(() => undefined);
  if (list) await store.lists.put({ ...list, videos: list.videos.filter((v) => v.id !== id) }).catch(() => undefined);
  await store.videos.delete(id).catch(() => undefined);
  await store.positions.delete(id).catch(() => undefined);
}

// ---------------- one video

export async function cachedWatchVideo(id: string): Promise<WatchVideoDetail | null> {
  const row = await getDb()?.videos.get(id).catch(() => undefined);
  return row?.video ?? null;
}

export async function storeWatchVideo(video: WatchVideoDetail): Promise<void> {
  const store = getDb();
  if (!store) return;
  await store.videos.put({ id: video.id, video, cached_at: Date.now() }).catch(() => undefined);
  // Keep the list row in step (status, progress) so the list shows it offline.
  const list = await store.lists.get('mine').catch(() => undefined);
  const { lines: _lines, gaps: _gaps, finished_at: _f, ...summary } = video;
  if (list) {
    const others = list.videos.filter((v) => v.id !== video.id);
    const old = list.videos.find((v) => v.id === video.id);
    await store.lists.put({ ...list, videos: [{ ...(old ?? {}), ...summary }, ...others] }).catch(() => undefined);
  } else {
    await store.lists.put({ id: 'mine', videos: [summary], available: true }).catch(() => undefined);
  }
}

export async function fetchWatchVideo(id: string): Promise<WatchVideoDetail> {
  const { video } = await getWatchVideo(id);
  await storeWatchVideo(video);
  return video;
}

// ---------------- position

export async function localPosition(id: string): Promise<number | null> {
  const row = await getDb()?.positions.get(id).catch(() => undefined);
  return row ? row.position_ms : null;
}

/** Save where I am on this device; `send` also tells the server (best effort, kept pending on failure). */
export async function rememberPosition(id: string, positionMs: number, send: boolean, keepalive = false): Promise<void> {
  const store = getDb();
  const ms = Math.max(0, Math.round(positionMs));
  await store?.positions.put({ id, position_ms: ms, at: Date.now(), pending: 1 }).catch(() => undefined);
  if (!send || !navigator.onLine) return;
  try {
    await saveWatchPosition(id, ms, keepalive);
    const row = await store?.positions.get(id).catch(() => undefined);
    if (row && row.position_ms === ms) await store?.positions.put({ ...row, pending: 0 }).catch(() => undefined);
  } catch {
    /* sent next time */
  }
}

/** Positions saved offline → the server (the list page calls it when online). */
export async function flushPositions(): Promise<void> {
  const store = getDb();
  if (!store || !navigator.onLine) return;
  const pending = await store.positions.where('pending').equals(1).toArray().catch(() => []);
  for (const p of pending) {
    try {
      await saveWatchPosition(p.id, p.position_ms);
      await store.positions.put({ ...p, pending: 0 }).catch(() => undefined);
    } catch {
      return;
    }
  }
}

// ---------------- player switches (per device)

export type WatchPref = 'pinyin' | 'english' | 'pause' | 'listen';
const PREF_KEY = (k: WatchPref) => `watch-${k}-v1`;
const PREF_DEFAULT: Record<WatchPref, boolean> = { pinyin: true, english: true, pause: false, listen: false };

export function readWatchPref(k: WatchPref): boolean {
  try {
    const v = localStorage.getItem(PREF_KEY(k));
    return v === null ? PREF_DEFAULT[k] : v === '1';
  } catch {
    return PREF_DEFAULT[k];
  }
}

export function writeWatchPref(k: WatchPref, on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY(k), on ? '1' : '0');
  } catch {
    /* private mode */
  }
}

const SPEED_KEY = 'watch-speed-v1';

export function readWatchSpeed(): number {
  try {
    return parseWatchSpeed(localStorage.getItem(SPEED_KEY));
  } catch {
    return 1;
  }
}

export function writeWatchSpeed(speed: number): void {
  try {
    localStorage.setItem(SPEED_KEY, String(speed));
  } catch {
    /* private mode */
  }
}
