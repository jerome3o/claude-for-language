/**
 * Link previews under chat messages (docs/CHAT.md "Round 2"): asked of the
 * worker once per URL and kept on the device (localStorage, newest 200), so a
 * chat reopened offline still shows its cards. A page with nothing to show is
 * remembered as "none" for a day.
 */
import { useEffect, useState } from 'react';
import { fetchLinkPreview, type LinkPreviewData } from '../api/chat';

const KEY = 'chat-link-previews-v1';
const MAX = 200;
const NONE_TTL_MS = 24 * 3600_000;

type Entry = { p: LinkPreviewData | null; at: number };

function load(): Record<string, Entry> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, Entry>;
  } catch {
    return {};
  }
}

function save(all: Record<string, Entry>) {
  const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0, MAX);
  const kept: Record<string, Entry> = {};
  for (const k of keys) kept[k] = all[k];
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    /* full / blocked: previews just aren't kept */
  }
}

export function cachedLinkPreview(url: string): LinkPreviewData | null | undefined {
  const e = load()[url];
  if (!e) return undefined;
  if (!e.p && Date.now() - e.at > NONE_TTL_MS) return undefined;
  return e.p;
}

const inflight = new Map<string, Promise<LinkPreviewData | null>>();

export function getLinkPreview(url: string): Promise<LinkPreviewData | null> {
  const hit = cachedLinkPreview(url);
  if (hit !== undefined) return Promise.resolve(hit);
  let p = inflight.get(url);
  if (!p) {
    p = fetchLinkPreview(url)
      .then((preview) => {
        const all = load();
        all[url] = { p: preview, at: Date.now() };
        save(all);
        return preview;
      })
      .finally(() => inflight.delete(url));
    inflight.set(url, p);
  }
  return p;
}

/** The preview for `url` (null = none / not yet / offline). */
export function useLinkPreview(url: string | null, enabled: boolean): LinkPreviewData | null {
  const [preview, setPreview] = useState<LinkPreviewData | null>(() => (url ? cachedLinkPreview(url) ?? null : null));
  useEffect(() => {
    if (!url) {
      setPreview(null);
      return;
    }
    const hit = cachedLinkPreview(url);
    if (hit !== undefined) {
      setPreview(hit);
      return;
    }
    if (!enabled) return;
    let live = true;
    getLinkPreview(url)
      .then((p) => live && setPreview(p))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [url, enabled]);
  return preview;
}
