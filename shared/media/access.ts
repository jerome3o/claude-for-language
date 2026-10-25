/**
 * Who may fetch an R2 object through `GET /api/audio/<key>` (docs/AUDIO.md "Private media").
 *
 * The bucket holds everything the app stores. Only content the app GENERATES itself (TTS clips,
 * generated pictures) and profile photos are public — served to anyone, cached for a year. What a
 * person MADE (study recordings, lesson answers, call audio, uploaded card photos, lesson-note
 * files, feedback screenshots) is `private`: served only with a credential — a short-lived signed link (`?exp=&sig=`,
 * minted by the API for an authorised caller), the user's media token (`?mt=`), or the session as
 * `Authorization: Bearer` — and only to someone allowed to see it (the owner, their tutor, the
 * call's members). Anything else (chat media, audio lessons, tutor model recordings, materials,
 * picture-hunt photos, screenshots, debug reports, podcast copies, TTS caches, unknown prefixes)
 * is never served here: each has its own authenticated route, or no client needs it.
 *
 * Keep in step with STORAGE_PREFIXES (worker services/admin/storage-cleanup.ts; its test checks
 * every registered prefix is classified here on purpose). The Lab app needs no port: it sends its
 * session on every download from the API, whatever the key.
 */

export type MediaAccess = 'public' | 'private' | 'none';

/** Generated content + profile photos: public, cacheable for a year. */
export const PUBLIC_MEDIA_PREFIXES = ['generated/', 'reader-images/', 'lesson-images/', 'note-images/', 'avatars/', 'meme-review/images/'] as const;

/** Person-made media served through /api/audio/* with a credential + an authorisation check. */
export const PRIVATE_MEDIA_PREFIXES = ['recordings/', 'calls/', 'note-uploads/', 'lesson-notes/', 'feedback/'] as const;

/** Query parameter of the user's media token (`?mt=`). */
export const MEDIA_TOKEN_PARAM = 'mt';

/**
 * An R2 key from whatever a field holds: a bare key, `/api/audio/<key>`, an absolute URL to it,
 * with or without a query string.
 */
export function mediaKeyOf(value: string): string {
  let v = value.trim();
  v = v.replace(/^https?:\/\/[^/]+/i, '');
  v = v.replace(/[?#].*$/, '');
  v = v.replace(/^\/+/, '');
  v = v.replace(/^api\/audio\//, '');
  return v;
}

/** How the key is served by /api/audio/*. A key with a `..` segment or a backslash is never served. */
export function mediaAccessOf(keyOrUrl: string): MediaAccess {
  const key = mediaKeyOf(keyOrUrl);
  if (!key || key.includes('\\') || key.split('/').some((s) => s === '..' || s === '.')) return 'none';
  if (PUBLIC_MEDIA_PREFIXES.some((p) => key.startsWith(p))) return 'public';
  if (PRIVATE_MEDIA_PREFIXES.some((p) => key.startsWith(p))) return 'private';
  return 'none';
}

export function isPrivateMediaKey(keyOrUrl: string): boolean {
  return mediaAccessOf(keyOrUrl) === 'private';
}
