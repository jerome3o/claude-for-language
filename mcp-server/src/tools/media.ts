/**
 * Person-made media in tool results gets a SIGNED link that expires (docs/AUDIO.md "Private media").
 *
 * The API serves recordings, call audio, uploaded card photos… only with a credential
 * (shared/media/access.ts). A tool result ends up in a chat transcript, so it must never carry a
 * permanent link: every string in a result that is a private key (`recordings/x.webm`) or a link to
 * one (`<api>/api/audio/recordings/x.webm`) is swapped for `<api>/api/audio/<key>?exp=&sig=`, minted
 * by `POST /api/media/sign` for the signed-in user — which also checks they may see it (a key they
 * may not see is left as it was, and does not play). 24 h, long enough to listen from the chat.
 */
import type { ApiClient } from '../api.js';
import { isPrivateMediaKey, mediaKeyOf } from '../../../shared/media/access';

export const MCP_MEDIA_LINK_TTL_S = 24 * 3600;
const MAX_KEYS = 100;

function candidate(value: string, apiBase: string): boolean {
  if (value.length > 600 || /\s/.test(value)) return false;
  const isLink = value.startsWith('/api/audio/') || value.startsWith(`${apiBase.replace(/\/+$/, '')}/api/audio/`);
  const isBareKey = !value.includes(':') && !value.startsWith('/');
  if (!isLink && !isBareKey) return false;
  if (isLink && /[?&]sig=/.test(value)) return false;
  return isPrivateMediaKey(value);
}

function collect(value: unknown, apiBase: string, out: Set<string>): void {
  if (typeof value === 'string') {
    if (candidate(value, apiBase)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collect(v, apiBase, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collect(v, apiBase, out);
  }
}

function replace(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === 'string') return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => replace(v, map));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = replace(v, map);
    return out;
  }
  return value;
}

/** `data` with every private media key / link replaced by a signed absolute link. Never throws. */
export async function signMediaUrls<T>(api: Pick<ApiClient, 'post' | 'baseUrl'>, data: T): Promise<T> {
  const base = api.baseUrl.replace(/\/+$/, '');
  const found = new Set<string>();
  collect(data, base, found);
  if (found.size === 0) return data;
  const byKey = new Map<string, string[]>();
  for (const v of found) {
    const k = mediaKeyOf(v);
    byKey.set(k, [...(byKey.get(k) ?? []), v]);
  }
  const map = new Map<string, string>();
  const keys = [...byKey.keys()];
  try {
    for (let i = 0; i < keys.length; i += MAX_KEYS) {
      const chunk = keys.slice(i, i + MAX_KEYS);
      const res = await api.post<{ urls: Record<string, string | null> }>('/api/media/sign', { keys: chunk, ttl_s: MCP_MEDIA_LINK_TTL_S });
      for (const k of chunk) {
        const path = res.urls?.[k];
        if (!path) continue;
        for (const original of byKey.get(k) ?? []) map.set(original, `${base}${path}`);
      }
    }
  } catch (err) {
    console.warn('[media] signing failed:', err instanceof Error ? err.message : err);
  }
  return map.size ? (replace(data, map) as T) : data;
}
