/**
 * 🎬 Clips on the device (experimental, docs/CLIPS.md). The feed is kept in its OWN small
 * IndexedDB database (`clips` — apart from ChineseLearningDB, so the experiment needs no schema
 * bump): the clips with their specs, and an outbox of events (views, likes, saves, quiz
 * answers…) uploaded when online (idempotent by id). A clip's voice lines are the practice-TTS
 * clips (services/ttsCache.ts, kept on the device) and its pictures the R2 keys (audioCache), so
 * a clip played — or prefetched — once plays offline.
 */
import Dexie, { type Table } from 'dexie';
import { CLIP_TTS_SPEED, clipAudioClips, type ClipEvent, type ClipEventKind, type ClipRecord } from '@shared/clips';
import { listClips, postClipEvents } from '../api/clips';
import { getTTSWithCache } from './ttsCache';
import { getAudioWithCache, getCachedAudio } from './audioCache';

interface StoredFeed {
  id: 'feed';
  clips: ClipRecord[];
  cached_at: number;
}

interface StoredEvent extends ClipEvent {
  created_at: string;
}

class ClipsDB extends Dexie {
  feed!: Table<StoredFeed, string>;
  events!: Table<StoredEvent, string>;
  constructor() {
    super('clips');
    this.version(1).stores({ feed: 'id', events: 'id' });
  }
}

let db: ClipsDB | null = null;
function getDb(): ClipsDB | null {
  if (db) return db;
  try {
    db = new ClipsDB();
    return db;
  } catch {
    return null;
  }
}

export async function cachedClipFeed(): Promise<ClipRecord[] | null> {
  const row = await getDb()?.feed.get('feed').catch(() => undefined);
  return row ? withPendingEvents(row.clips, await pendingEvents()) : null;
}

async function pendingEvents(): Promise<StoredEvent[]> {
  return ((await getDb()?.events.toArray().catch(() => [])) ?? []).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
}

/** The device's events not yet uploaded, applied on top of the server's state (like / save / seen). */
export function withPendingEvents(clips: ClipRecord[], events: Pick<ClipEvent, 'clip_id' | 'kind'>[]): ClipRecord[] {
  if (!events.length) return clips;
  return clips.map((c) => {
    const mine = events.filter((e) => e.clip_id === c.id);
    if (!mine.length) return c;
    const state = { ...c.state };
    for (const e of mine) {
      if (e.kind === 'view') state.viewed = true;
      else if (e.kind === 'complete') state.viewed = state.completed = true;
      else if (e.kind === 'like') state.liked = true;
      else if (e.kind === 'unlike') state.liked = false;
      else if (e.kind === 'save') state.saved = true;
      else if (e.kind === 'unsave') state.saved = false;
      else if (e.kind === 'skip') state.skips++;
    }
    return { ...c, state };
  });
}

/** The feed from the server (kept on the device); offline / failure → the cached one. */
export async function refreshClipFeed(): Promise<ClipRecord[] | null> {
  if (!navigator.onLine) return cachedClipFeed();
  try {
    await flushClipEvents();
    const { clips } = await listClips();
    await getDb()?.feed.put({ id: 'feed', clips, cached_at: Date.now() }).catch(() => undefined);
    return withPendingEvents(clips, await pendingEvents());
  } catch (err) {
    console.warn('[clips] feed refresh failed', err);
    return cachedClipFeed();
  }
}

/** Replace one clip in the cached feed (a lesson started, a generation finished). */
export async function cacheClip(clip: ClipRecord): Promise<void> {
  const store = getDb();
  const row = await store?.feed.get('feed').catch(() => undefined);
  if (!store || !row) return;
  const has = row.clips.some((c) => c.id === clip.id);
  const clips = has ? row.clips.map((c) => (c.id === clip.id ? clip : c)) : [clip, ...row.clips];
  await store.feed.put({ ...row, clips }).catch(() => undefined);
}

let flushing: Promise<void> | null = null;

/** Upload the outbox (online only); kept on failure. */
export function flushClipEvents(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    const store = getDb();
    if (!store || !navigator.onLine) return;
    const events = await pendingEvents();
    for (let i = 0; i < events.length; i += 100) {
      const batch = events.slice(i, i + 100);
      try {
        await postClipEvents(batch);
        await store.events.bulkDelete(batch.map((e) => e.id));
      } catch (err) {
        console.warn('[clips] events upload failed', err);
        return;
      }
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** Record an event on the device (and upload soon). */
export async function recordClipEvent(clipId: string, kind: ClipEventKind, value?: number): Promise<void> {
  const event: StoredEvent = { id: crypto.randomUUID(), clip_id: clipId, kind, ...(value !== undefined ? { value } : {}), created_at: new Date().toISOString() };
  await getDb()?.events.put(event).catch(() => undefined);
  void flushClipEvents();
}

// ---------- Media ----------

/** A clip line's audio (cached on the device; null offline when never fetched). */
export function clipLineAudio(text: string, voiceId: string | null): Promise<Blob | null> {
  return getTTSWithCache(text, CLIP_TTS_SPEED, voiceId ?? undefined);
}

/** A picture by its R2 key: the cached blob, else fetched and kept (null offline). */
export async function clipPicture(key: string): Promise<Blob | null> {
  return (await getCachedAudio(key).catch(() => null)) ?? (navigator.onLine ? getAudioWithCache(key).catch(() => null) : null);
}

const prefetched = new Set<string>();

/** Fetch a clip's voice lines and pictures ahead (the next clip in the feed). */
export async function prefetchClip(clip: ClipRecord): Promise<void> {
  if (!clip.spec || prefetched.has(clip.id) || !navigator.onLine) return;
  prefetched.add(clip.id);
  for (const key of Object.values(clip.images)) await clipPicture(key);
  for (const line of clipAudioClips(clip.spec)) {
    if (!navigator.onLine) return;
    await clipLineAudio(line.text, line.voice_id);
  }
}

// ---------- Per-device preferences ----------

export interface ClipCaptionPrefs {
  pinyin: boolean;
  english: boolean;
  muted: boolean;
}

const PREFS_KEY = 'clips-captions-v1';
export const DEFAULT_CLIP_PREFS: ClipCaptionPrefs = { pinyin: true, english: true, muted: false };

export function loadClipPrefs(): ClipCaptionPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_CLIP_PREFS, ...(JSON.parse(raw) as Partial<ClipCaptionPrefs>) } : DEFAULT_CLIP_PREFS;
  } catch {
    return DEFAULT_CLIP_PREFS;
  }
}

export function saveClipPrefs(prefs: ClipCaptionPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode */
  }
}
