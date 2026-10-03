/**
 * Chat photos and voice messages on the device (docs/CHAT.md PR 2):
 *  - `compressPhoto`: any picked / captured image → ≤ 1600 px JPEG, q 0.8;
 *  - `chatMediaUrl`: the bytes of a message's attachment as a blob URL — memory,
 *    then Cache Storage (so a revisit is instant and works offline), then an
 *    authenticated fetch of `/api/chat-media/<id>`;
 *  - `primeChatMedia`: a message I just sent already has its bytes — no download;
 *  - `pickRecorderMime`: what MediaRecorder can make here (webm/opus, mp4 on Safari).
 */

import { useEffect, useState } from 'react';
import { fetchChatMediaBlob } from '../api/chat';
import { scaleToFit } from './chatThread';

export const PHOTO_MAX_SIDE = 1600;
export const PHOTO_QUALITY = 0.8;
const CACHE_NAME = 'chat-media-v1';

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close?: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall back to <img> (HEIC on some browsers, old Safari) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Couldn't read that picture"));
      img.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Shrink a photo for sending: longest side ≤ 1600 px, JPEG q 0.8 (white behind transparency). */
export async function compressPhoto(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await decode(file);
  try {
    const { width, height } = scaleToFit(img.width, img.height, PHOTO_MAX_SIDE);
    if (!width || !height) throw new Error("Couldn't read that picture");
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Couldn't prepare the picture");
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY));
    if (!blob) throw new Error("Couldn't prepare the picture");
    return { blob, width, height };
  } finally {
    img.close?.();
  }
}

/** The MediaRecorder type to record voice messages in, or '' to let the browser choose. */
export function pickRecorderMime(isSupported: (mime: string) => boolean): string {
  for (const mime of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/aac']) {
    try {
      if (isSupported(mime)) return mime;
    } catch {
      /* ignore */
    }
  }
  return '';
}

/** `audio/webm;codecs=opus` → `audio/webm` (what the upload's Content-Type carries). */
export function baseMime(mime: string): string {
  return (mime || '').split(';')[0].trim().toLowerCase();
}

// ---------- The media cache ----------

const urls = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function cacheKey(messageId: string): string {
  return `${typeof location !== 'undefined' ? location.origin : 'https://app.invalid'}/__chat-media/${encodeURIComponent(messageId)}`;
}

async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return null;
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

/** Keep bytes I already hold (a photo / recording I just sent) under the server message id. */
export async function primeChatMedia(messageId: string, blob: Blob): Promise<void> {
  if (!urls.has(messageId)) urls.set(messageId, URL.createObjectURL(blob));
  const cache = await openCache();
  try {
    await cache?.put(cacheKey(messageId), new Response(blob, { headers: { 'Content-Type': blob.type || 'application/octet-stream' } }));
  } catch {
    /* quota / private mode — memory still has it */
  }
}

/** A blob URL for a message's attachment (memory → Cache Storage → network). */
export function chatMediaUrl(messageId: string, mediaUrl: string): Promise<string> {
  const known = urls.get(messageId);
  if (known) return Promise.resolve(known);
  const running = inflight.get(messageId);
  if (running) return running;
  const p = (async () => {
    const cache = await openCache();
    let blob: Blob | null = null;
    try {
      const hit = await cache?.match(cacheKey(messageId));
      if (hit) blob = await hit.blob();
    } catch {
      blob = null;
    }
    if (!blob) {
      blob = await fetchChatMediaBlob(mediaUrl);
      try {
        await cache?.put(cacheKey(messageId), new Response(blob, { headers: { 'Content-Type': blob.type || 'application/octet-stream' } }));
      } catch {
        /* not cached — fine */
      }
    }
    const url = URL.createObjectURL(blob);
    urls.set(messageId, url);
    return url;
  })().finally(() => inflight.delete(messageId));
  inflight.set(messageId, p);
  return p;
}

/** Drop a deleted message's bytes from the device. */
export async function forgetChatMedia(messageId: string): Promise<void> {
  const url = urls.get(messageId);
  if (url) URL.revokeObjectURL(url);
  urls.delete(messageId);
  const cache = await openCache();
  try {
    await cache?.delete(cacheKey(messageId));
  } catch {
    /* ignore */
  }
}

/**
 * The blob URL of a message's media. `localBlob` (a pending send) is used as is;
 * otherwise the server's bytes are fetched once and cached.
 */
export function useChatMedia(
  messageId: string,
  mediaUrl: string | null | undefined,
  localBlob?: Blob | null,
  /** False = don't download yet (a file is fetched when it is opened). */
  enabled = true,
): { url: string | null; error: boolean; retry: () => void } {
  const [url, setUrl] = useState<string | null>(() => (localBlob ? null : urls.get(messageId) ?? null));
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!localBlob) return;
    const u = URL.createObjectURL(localBlob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [localBlob]);

  useEffect(() => {
    if (localBlob || !mediaUrl || !enabled) return;
    let alive = true;
    setError(false);
    chatMediaUrl(messageId, mediaUrl).then(
      (u) => alive && setUrl(u),
      () => alive && setError(true),
    );
    return () => {
      alive = false;
    };
  }, [messageId, mediaUrl, localBlob, attempt, enabled]);

  return { url, error, retry: () => setAttempt((n) => n + 1) };
}

// ---------- Files and video clips (round 2 PR 3) ----------

export const FILE_MAX_BYTES = 20 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 25 * 1024 * 1024;
/** The extensions the server takes as a file (worker services/chat/media.ts FILE_TYPES). */
export const FILE_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'txt', 'csv', 'md', 'rtf', 'zip', 'apkg', 'epub', 'mp3', 'm4a', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'];

/** Why a picked file can't be sent, or null. */
export function fileProblem(file: { name: string; size: number }): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!FILE_EXTENSIONS.includes(ext)) return 'That kind of file can’t be sent — PDF, Office documents, text, zip, audio or pictures.';
  if (file.size > FILE_MAX_BYTES) return 'Files can be at most 20 MB.';
  if (file.size === 0) return 'That file is empty.';
  return null;
}

/** A video's length and shape, read by the browser (null fields when it can't tell). */
export function videoInfo(file: Blob): Promise<{ duration_ms: number | null; width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const done = (r: { duration_ms: number | null; width: number | null; height: number | null }) => {
      URL.revokeObjectURL(url);
      resolve(r);
    };
    const timer = setTimeout(() => done({ duration_ms: null, width: null, height: null }), 5000);
    v.onloadedmetadata = () => {
      clearTimeout(timer);
      done({
        duration_ms: Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : null,
        width: v.videoWidth || null,
        height: v.videoHeight || null,
      });
    };
    v.onerror = () => {
      clearTimeout(timer);
      done({ duration_ms: null, width: null, height: null });
    };
    v.src = url;
  });
}
