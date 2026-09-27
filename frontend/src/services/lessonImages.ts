/**
 * describe_image pictures on the device.
 *
 * The worker draws one picture per scene description (worker/src/services/
 * lesson-images.ts) and writes its key into every lesson copy that waits for
 * it; the next lesson sync brings the key down. Until then — and for specs
 * that never carry a key (library previews, the catalogue samples) — the
 * player asks by prompt: `POST /api/lesson-images/ensure` returns the key, or
 * "pending" while it is being drawn (the player polls and shows "Drawing the
 * picture…").
 *
 * Offline: prompt → key is remembered in localStorage, the picture itself is
 * in the audio blob cache (IndexedDB, same /api/audio proxy as reader
 * pictures), so a picture seen once shows on the train.
 */

import { normalizeImagePrompt, describeImagePrompts } from '@shared/lesson/images';
import { SAMPLE_LESSONS } from '@shared/lesson/samples';
import { API_BASE, getAuthHeaders } from '../api/client';
import { getAudioWithCache, isAudioCached } from './audioCache';

export type LessonImageStatus = 'ready' | 'pending' | 'failed' | 'unavailable' | 'missing';

export interface LessonImageResult {
  prompt: string;
  status: LessonImageStatus;
  image_url: string | null;
}

const KEYS_STORAGE = 'lesson-image-keys:v1';
const MAX_REMEMBERED = 300;
const TOP_UP_STORAGE = 'lesson-images-top-up-at';
const TOP_UP_INTERVAL_MS = 60 * 60 * 1000;

// ============ prompt → key memory ============

function readKeys(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEYS_STORAGE);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

export function rememberedLessonImageKey(prompt: string | null | undefined): string | null {
  if (!prompt) return null;
  return readKeys()[normalizeImagePrompt(prompt)] ?? null;
}

export function rememberLessonImageKey(prompt: string, key: string): void {
  try {
    const keys = readKeys();
    const norm = normalizeImagePrompt(prompt);
    if (keys[norm] === key) return;
    delete keys[norm];
    keys[norm] = key; // newest last
    const entries = Object.entries(keys);
    const kept = entries.length > MAX_REMEMBERED ? Object.fromEntries(entries.slice(-MAX_REMEMBERED)) : keys;
    localStorage.setItem(KEYS_STORAGE, JSON.stringify(kept));
  } catch {
    // Storage full or blocked: the picture still shows while online.
  }
}

// ============ API ============

/**
 * Ask for pictures by scene description. `queue: false` only looks them up
 * (the editor form while the tutor types) — nothing is drawn.
 */
export async function ensureLessonImages(prompts: string[], opts: { queue?: boolean } = {}): Promise<LessonImageResult[]> {
  const response = await fetch(`${API_BASE}/api/lesson-images/ensure`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ prompts, ...(opts.queue === false ? { queue: false } : {}) }),
  });
  if (!response.ok) throw new Error(`Picture lookup failed (${response.status})`);
  const data = await response.json() as { images: LessonImageResult[] };
  for (const r of data.images ?? []) {
    if (r.status === 'ready' && r.image_url) rememberLessonImageKey(r.prompt, r.image_url);
  }
  return data.images ?? [];
}

/** Cache a picture for offline use (no-op if already cached). */
export async function prefetchLessonImage(key: string): Promise<void> {
  if (!(await isAudioCached(key))) await getAudioWithCache(key);
}

/**
 * Hourly, from the sync: the server writes ready pictures into this
 * account's lessons (or queues the missing ones) and pre-draws the catalogue
 * samples; then the sample pictures are cached so the catalogue's "Try it"
 * shows a picture offline too.
 */
export async function topUpLessonImagesIfDue(): Promise<{ pending: number; applied: number } | null> {
  if (!navigator.onLine) return null;
  try {
    const last = Number(localStorage.getItem(TOP_UP_STORAGE) || 0);
    if (Date.now() - last < TOP_UP_INTERVAL_MS) return null;
    localStorage.setItem(TOP_UP_STORAGE, String(Date.now()));
  } catch {
    // No storage: run it (the server side is idempotent).
  }
  const response = await fetch(`${API_BASE}/api/lesson-images/top-up`, {
    method: 'POST',
    credentials: 'include',
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw new Error(`Lesson picture top-up failed (${response.status})`);
  const result = await response.json() as { pending: number; applied: number };

  const samplePrompts = SAMPLE_LESSONS.flatMap(s => describeImagePrompts(s.spec));
  if (samplePrompts.length > 0) {
    const images = await ensureLessonImages(samplePrompts);
    for (const img of images) {
      if (img.status === 'ready' && img.image_url) await prefetchLessonImage(img.image_url).catch(() => {});
    }
  }
  return result;
}
