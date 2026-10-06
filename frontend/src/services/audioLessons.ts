/**
 * Audio lessons on the device (docs/AUDIO_LESSONS.md "Offline"): the list and
 * each lesson's details in localStorage, the MP3 itself in the Cache API
 * (`audio-lessons-v1`, keyed by lesson + file version, so a rebuilt lesson is
 * downloaded again and the old file dropped), and where the learner stopped.
 * A saved lesson plays with no connection at all.
 */
import type { AudioLessonDetail, AudioLessonSummary } from '@shared/audio-lesson';
import * as api from '../api/audioLessons';

const LIST_KEY = 'audio-lessons-list-v1';
const DETAIL_KEY = (id: string) => `audio-lesson-detail-v1:${id}`;
const POSITION_KEY = (id: string) => `audio-lesson-pos-v1:${id}`;
export const AUDIO_LESSON_CACHE = 'audio-lessons-v1';

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full / private mode: the lesson still plays online.
  }
}

export function cachedLessonList(): AudioLessonSummary[] {
  return readJson<AudioLessonSummary[]>(LIST_KEY) ?? [];
}

export async function refreshLessonList(): Promise<AudioLessonSummary[]> {
  const { lessons } = await api.listAudioLessons();
  writeJson(LIST_KEY, lessons);
  return lessons;
}

export function rememberLessonInList(lesson: AudioLessonSummary): void {
  writeJson(LIST_KEY, [lesson, ...cachedLessonList().filter((l) => l.id !== lesson.id)]);
}

export function cachedLessonDetail(id: string): AudioLessonDetail | null {
  return readJson<AudioLessonDetail>(DETAIL_KEY(id));
}

export async function fetchLessonDetail(id: string): Promise<AudioLessonDetail> {
  const { lesson } = await api.getAudioLesson(id);
  if (lesson.status === 'ready') writeJson(DETAIL_KEY(id), lesson);
  return lesson;
}

// ---------- The file ----------

function fileUrl(id: string, version: string): string {
  return `/__audio-lessons/${encodeURIComponent(id)}/${encodeURIComponent(version)}.mp3`;
}

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(AUDIO_LESSON_CACHE);
  } catch {
    return null;
  }
}

/** Lesson ids with a saved file (any version). */
export async function savedLessonIds(): Promise<Set<string>> {
  const cache = await openCache();
  if (!cache) return new Set();
  const keys = await cache.keys();
  return new Set(keys.map((r) => decodeURIComponent(new URL(r.url).pathname.split('/')[2] ?? '')));
}

export async function savedFile(id: string, version: string): Promise<Blob | null> {
  const cache = await openCache();
  const hit = cache ? await cache.match(fileUrl(id, version)) : undefined;
  return hit ? hit.blob() : null;
}

async function dropOtherVersions(cache: Cache, id: string, keep: string | null): Promise<void> {
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (decodeURIComponent(path.split('/')[2] ?? '') === id && (!keep || path !== fileUrl(id, keep))) await cache.delete(req);
  }
}

/**
 * Download the lesson's file (progress 0..1 when the size is known) and keep it
 * on the device. Returns the blob to play.
 */
export async function downloadLessonFile(id: string, version: string, onProgress?: (fraction: number, bytes: number) => void): Promise<Blob> {
  const res = await api.fetchAudioLessonFile(id);
  const total = Number(res.headers.get('Content-Length') || 0);
  let blob: Blob;
  if (res.body && onProgress) {
    const reader = res.body.getReader();
    const chunks: BlobPart[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(total ? got / total : 0, got);
    }
    blob = new Blob(chunks, { type: 'audio/mpeg' });
  } else {
    blob = await res.blob();
  }
  const cache = await openCache();
  if (cache) {
    await cache.put(fileUrl(id, version), new Response(blob, { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(blob.size) } }));
    await dropOtherVersions(cache, id, version);
  }
  return blob;
}

export async function removeSavedFile(id: string): Promise<void> {
  const cache = await openCache();
  if (cache) await dropOtherVersions(cache, id, null);
}

export async function deleteLessonEverywhere(id: string): Promise<void> {
  await api.deleteAudioLesson(id);
  await removeSavedFile(id);
  try {
    localStorage.removeItem(DETAIL_KEY(id));
    localStorage.removeItem(POSITION_KEY(id));
  } catch {
    /* ignore */
  }
  writeJson(LIST_KEY, cachedLessonList().filter((l) => l.id !== id));
}

// ---------- Where the learner stopped ----------

export function savedPosition(id: string): number {
  const p = readJson<{ ms: number }>(POSITION_KEY(id));
  return p?.ms ?? 0;
}

export function savePosition(id: string, ms: number): void {
  writeJson(POSITION_KEY(id), { ms: Math.max(0, Math.round(ms)), at: Date.now() });
}

export function formatMb(bytes: number | null | undefined): string {
  if (!bytes) return '';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
