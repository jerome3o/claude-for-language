/**
 * Pictures shown in VR windows (reader pages, the feedback screenshot), decoded to ImageBitmaps
 * for the panel canvases. Same-origin blobs only — the device cache first (services/audioCache,
 * the reader's offline copy), else fetched once and kept there — so a texture is never tainted by
 * a cross-origin image and nothing is loaded from a URL a panel spec could name.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { getAudioWithCache, getCachedAudio } from '../services/audioCache';
import type { PanelView } from './scene/WindowFrame';
import type { UiNode } from './ui/layout';
import type { PanelImage } from './ui/draw';

/** Image keys referenced by the views (only R2 media keys: no scheme, no host). */
export function imageKeysOf(views: readonly PanelView[]): string[] {
  const keys = new Set<string>();
  const walk = (nodes: readonly UiNode[]) => {
    for (const n of nodes) {
      if (n.t === 'image' && isMediaKey(n.key)) keys.add(n.key);
    }
  };
  for (const v of views) walk(v.nodes);
  return [...keys].sort();
}

/** An R2 key like `reader-images/abc.png` — never a URL (`https:`, `//host`, `data:`, `javascript:`). */
export function isMediaKey(key: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,300}$/.test(key) && !key.includes('..') && !key.includes('//');
}

async function decode(blob: Blob): Promise<PanelImage | null> {
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

export function useVrImages(keys: readonly string[], local: Record<string, Blob>): ReadonlyMap<string, PanelImage> {
  const [loaded, setLoaded] = useState<Map<string, PanelImage>>(() => new Map());
  const pending = useRef(new Set<string>());
  const localKeys = Object.keys(local).sort().join('|');
  const localBlobs = useRef(local);
  localBlobs.current = local;

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const want = [...keys, ...Object.keys(localBlobs.current)];
    for (const key of want) {
      if (loaded.has(key) || pending.current.has(key)) continue;
      pending.current.add(key);
      const blobPromise = localBlobs.current[key]
        ? Promise.resolve(localBlobs.current[key])
        : getCachedAudio(key).then((b) => b ?? (navigator.onLine ? getAudioWithCache(key) : null));
      void blobPromise
        .then((b) => (b ? decode(b) : null))
        .then((img) => {
          pending.current.delete(key);
          // (not tied to this effect run: a later run skips keys still pending, so this one must land)
          if (!img || !mounted.current) return;
          setLoaded((m) => new Map(m).set(key, img));
        }, () => pending.current.delete(key));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.join('|'), localKeys]);

  // A new local blob under the same key (another screenshot) replaces the old picture.
  const lastLocal = useRef<Record<string, Blob>>({});
  useEffect(() => {
    for (const [k, b] of Object.entries(local)) {
      if (lastLocal.current[k] && lastLocal.current[k] !== b) {
        setLoaded((m) => {
          const next = new Map(m);
          next.delete(k);
          return next;
        });
        void decode(b).then((img) => img && setLoaded((m) => new Map(m).set(k, img)));
      }
    }
    lastLocal.current = local;
  }, [local]);

  return useMemo(() => loaded, [loaded]);
}
