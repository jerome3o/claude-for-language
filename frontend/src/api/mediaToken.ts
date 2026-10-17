/**
 * The user's media token (docs/AUDIO.md "Private media", worker routes/media.ts).
 *
 * Person-made media — study recordings, lesson answers, call audio, uploaded card photos — is
 * served by /api/audio/<key> only with a credential. `<audio src>` / `<img src>` can't send the
 * Authorization header, so private keys get `?mt=<token>`: a 3-day HMAC token naming this user
 * (the server still checks each key is theirs, or their student's). Public keys (TTS clips,
 * generated pictures) stay plain URLs. Offline copies are kept by R2 KEY (services/audioCache.ts,
 * the media blob cache), never by URL, so a new token never re-downloads anything.
 *
 * No imports from api/client.ts (it imports this module).
 */
import { isPrivateMediaKey, MEDIA_TOKEN_PARAM } from '@shared/media/access';

const STORAGE_KEY = 'media-token-v1';
/** Refresh when less than this is left (the token lives 3 days). */
const REFRESH_WHEN_LEFT_MS = 2 * 24 * 3600 * 1000;

export interface StoredMediaToken {
  token: string;
  expires_at: string;
}

let current: StoredMediaToken | null = load();

function load(): StoredMediaToken | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredMediaToken;
    return v && typeof v.token === 'string' && typeof v.expires_at === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** The token while it is valid, else null. */
export function getMediaToken(now = Date.now()): string | null {
  if (!current) return null;
  const exp = Date.parse(current.expires_at);
  return Number.isFinite(exp) && exp > now ? current.token : null;
}

export function setMediaToken(value: StoredMediaToken | null): void {
  current = value;
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — the token lives in memory */
  }
}

export function mediaTokenRefreshDue(now = Date.now()): boolean {
  if (!current) return true;
  const exp = Date.parse(current.expires_at);
  return !Number.isFinite(exp) || exp - now < REFRESH_WHEN_LEFT_MS;
}

/** `url` (the /api/audio/<key> URL of `key`) with the media token when the key is private. */
export function withMediaCredential(url: string, key: string): string {
  if (!isPrivateMediaKey(key)) return url;
  const token = getMediaToken();
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${MEDIA_TOKEN_PARAM}=${encodeURIComponent(token)}`;
}
