/**
 * Pictures on cards (shared/cards/note-image.ts; worker routes/note-images.ts): the API calls, the
 * device copy of a note's picture fields, the per-device "Show pictures on cards" switch and the
 * cache-first picture URL (the pictures ride the audio prefetch — GET /api/audio-manifest lists
 * them — so a card's picture shows on the train).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { IllustrateEstimate } from '@shared/cards/note-image';
import { API_BASE, authEvents, getAuthHeaders, getReaderImageUrl } from '../api/client';
import { db } from '../db/database';
import { getAudioWithCache, getCachedAudio } from './audioCache';

const API_PATH = `${API_BASE}/api`;

export interface NoteImageView {
  id: string;
  deck_id: string;
  image_key: string | null;
  image_source: 'generated' | 'upload' | null;
  image_status: 'pending' | 'failed' | null;
  image_at: string | null;
}

export interface DeckIllustrateStatus {
  deck_id: string;
  deck_name: string;
  total: number;
  with_image: number;
  pending: number;
  failed: number;
  missing: number;
  estimate: IllustrateEstimate;
  illustrate_new: boolean;
  available: boolean;
}

async function request<T>(url: string, options?: RequestInit, json = true): Promise<T> {
  const headers: Record<string, string> = {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...getAuthHeaders(),
    ...(options?.headers as Record<string, string> | undefined),
  };
  const response = await fetch(`${API_PATH}${url}`, { ...options, credentials: 'include', headers });
  if (response.status === 401) {
    authEvents.onUnauthorized();
    throw new Error('Unauthorized');
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

/** Write a picture's fields into IndexedDB at once: study, the deck page and Try it read them from there. */
export async function applyNoteImageLocally(view: NoteImageView): Promise<void> {
  try {
    await db.notes.update(view.id, {
      image_key: view.image_key,
      image_source: view.image_source,
      image_status: view.image_status,
    });
  } catch {
    /* not on this device (a student's note opened by the tutor) */
  }
  // Cache it for offline straight away.
  if (view.image_key) void getAudioWithCache(view.image_key).catch(() => {});
}

async function viewOf(p: Promise<{ note: NoteImageView }>): Promise<NoteImageView> {
  const { note } = await p;
  await applyNoteImageLocally(note);
  return note;
}

export function getNoteImage(noteId: string): Promise<NoteImageView> {
  return viewOf(request(`/notes/${noteId}/image`));
}

export function generateNoteImage(noteId: string, regenerate = false): Promise<NoteImageView> {
  return viewOf(request(`/notes/${noteId}/image/generate`, { method: 'POST', body: JSON.stringify({ regenerate }) }));
}

export function uploadNoteImage(noteId: string, picture: Blob): Promise<NoteImageView> {
  return viewOf(request(`/notes/${noteId}/image`, { method: 'PUT', body: picture, headers: { 'Content-Type': picture.type || 'image/jpeg' } }, false));
}

export function removeNoteImage(noteId: string): Promise<NoteImageView> {
  return viewOf(request(`/notes/${noteId}/image`, { method: 'DELETE' }));
}

export function getDeckIllustrate(deckId: string): Promise<DeckIllustrateStatus> {
  return request(`/decks/${deckId}/illustrate`);
}

export function startIllustrateDeck(deckId: string): Promise<{ ready: number; pending: number; queued: number; status: DeckIllustrateStatus }> {
  return request(`/decks/${deckId}/illustrate`, { method: 'POST', body: '{}' });
}

export function setIllustrateNew(deckId: string, on: boolean): Promise<{ illustrate_new: boolean }> {
  return request(`/decks/${deckId}/illustrate`, { method: 'PUT', body: JSON.stringify({ illustrate_new: on }) });
}

/**
 * Poll a note's picture while it is being drawn (every `everyMs`, at most `maxPolls` times);
 * calls `onUpdate` with each view and stops once it is no longer pending.
 */
export function pollNoteImage(noteId: string, onUpdate: (v: NoteImageView) => void, everyMs = 3000, maxPolls = 80): () => void {
  let stopped = false;
  let polls = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = async () => {
    if (stopped) return;
    polls++;
    try {
      const v = await getNoteImage(noteId);
      if (stopped) return;
      onUpdate(v);
      if (v.image_status !== 'pending') return;
    } catch {
      /* offline / blip: try again */
    }
    if (polls < maxPolls) timer = setTimeout(tick, everyMs);
  };
  timer = setTimeout(tick, everyMs);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

// ---------- "Show pictures on cards" (Settings → Study, per device, on by default) ----------

const PREF_KEY = 'card-pictures-v1';
const listeners = new Set<() => void>();

export function cardPicturesEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setCardPicturesEnabled(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: stays on for this page */
  }
  listeners.forEach(l => l());
}

export function useCardPicturesEnabled(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      const onStorage = (e: StorageEvent) => { if (e.key === PREF_KEY) cb(); };
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(cb);
        window.removeEventListener('storage', onStorage);
      };
    },
    cardPicturesEnabled,
    () => true,
  );
}

// ---------- The picture itself, cache-first ----------

/**
 * A picture's URL: the cached blob (works offline), else the direct URL while online (and cached
 * in the background), else null (offline and never downloaded — the card simply shows none).
 */
export function useNoteImageUrl(imageKey: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    if (!imageKey) return;
    (async () => {
      const blob = await getCachedAudio(imageKey).catch(() => null);
      if (cancelled) return;
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } else if (navigator.onLine) {
        setUrl(getReaderImageUrl(imageKey));
        void getAudioWithCache(imageKey).catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageKey]);
  return url;
}
