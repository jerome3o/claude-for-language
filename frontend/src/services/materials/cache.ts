/**
 * Material pages on this device (offline): page pictures are kept in the
 * Cache API (`materials-v1`), filled whenever a page is shown, presented or
 * uploaded here, and read first — so a material presented recently opens on
 * the train. Page lists are kept in localStorage per material.
 */

import { fetchPageImage, getMaterial, type MaterialInfo, type MaterialPageInfo } from '../../api/materials';

const CACHE = 'materials-v1';
const LIST_KEY = (id: string) => `material-v1:${id}`;

async function cache(): Promise<Cache | null> {
  try {
    return typeof caches !== 'undefined' ? await caches.open(CACHE) : null;
  } catch {
    return null;
  }
}

export async function cachePageImage(url: string, blob: Blob): Promise<void> {
  const c = await cache();
  await c?.put(url, new Response(blob, { headers: { 'Content-Type': blob.type || 'image/jpeg' } })).catch(() => {});
}

/** A page picture: from the device if it has it, else the network (then kept). */
export async function pageImage(url: string): Promise<Blob> {
  const c = await cache();
  const hit = await c?.match(url).catch(() => undefined);
  if (hit) return hit.blob();
  const blob = await fetchPageImage(url);
  void cachePageImage(url, blob);
  return blob;
}

/** Keep every page of a material (when presenting it, or "Keep on this device"). */
export async function prefetchMaterial(pages: MaterialPageInfo[]): Promise<void> {
  for (const p of pages) if (p.image_url) await pageImage(p.image_url).catch(() => {});
}

/** The material and its pages: online the server's, offline the last copy seen. */
export async function loadMaterial(id: string): Promise<{ material: MaterialInfo; pages: MaterialPageInfo[]; offline: boolean }> {
  try {
    const r = await getMaterial(id);
    try {
      localStorage.setItem(LIST_KEY(id), JSON.stringify(r));
    } catch {
      /* full / private mode */
    }
    return { ...r, offline: false };
  } catch (err) {
    try {
      const saved = localStorage.getItem(LIST_KEY(id));
      if (saved) return { ...(JSON.parse(saved) as { material: MaterialInfo; pages: MaterialPageInfo[] }), offline: true };
    } catch {
      /* fall through */
    }
    throw err;
  }
}
