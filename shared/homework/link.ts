/**
 * Link homework (docs/HOMEWORK.md §8): an external link — a YouTube video, a
 * song, a TV-drama clip, an article — with a title and instructions. Nothing
 * is hosted or embedded: the app only links out. A YouTube link gets its
 * public thumbnail (i.ytimg.com), which needs no API call.
 *
 * Pure, so the worker (validation), the web app and the Lab app
 * (core `HomeworkLink.kt`, parity-tested) agree on what a link is.
 */

export const LINK_TITLE_MAX = 160;
export const LINK_INSTRUCTIONS_MAX = 2000;
export const LINK_URL_MAX = 2000;
/** The student's note back to the tutor when marking it done. */
export const LINK_NOTE_MAX = 1000;

/**
 * A pasted link as a canonical http(s) URL, or null when it is not one.
 * "youtu.be/abc" → "https://youtu.be/abc"; other schemes (javascript:, data:,
 * file:) are refused.
 */
export function normalizeLinkUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  if (!text || text.length > LINK_URL_MAX || /\s/.test(text)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  const m = /^(https?):\/\/([^/?#\s]+)(.*)$/i.exec(text);
  if (!m) return null;
  const host = m[2].toLowerCase();
  // A host needs a dot (or is localhost) and no credentials.
  if (host.includes('@')) return null;
  const bare = host.replace(/:\d+$/, '');
  if (!bare || (!bare.includes('.') && bare !== 'localhost')) return null;
  if (!/^[a-z0-9.-]+$/.test(bare) || bare.startsWith('.') || bare.endsWith('.')) return null;
  return `${m[1].toLowerCase()}://${host}${m[3]}`;
}

/** The hostname without "www." / "m." ("youtube.com"), or '' for a bad URL. */
export function linkHost(url: string): string {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(url);
  return m ? m[1].toLowerCase().replace(/^(www|m)\./, '') : '';
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** The video id of a YouTube link (watch, youtu.be, shorts, embed, live), else null. */
export function youtubeVideoId(url: string): string | null {
  const host = linkHost(url);
  const m = /^https?:\/\/[^/?#]+([^?#]*)(\?[^#]*)?/i.exec(url);
  if (!m) return null;
  const path = m[1];
  const query = m[2] ?? '';
  let id: string | null = null;
  if (host === 'youtu.be') {
    id = path.split('/')[1] ?? null;
  } else if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    if (path === '/watch') {
      const v = /[?&]v=([^&]+)/.exec(query);
      id = v ? v[1] : null;
    } else {
      const p = /^\/(shorts|embed|live|v)\/([^/]+)/.exec(path);
      id = p ? p[2] : null;
    }
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

/** A thumbnail for the link: YouTube's public one, else null (no fetching). */
export function linkThumbnail(url: string): string | null {
  const id = youtubeVideoId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

const SITE_NAMES: Record<string, string> = {
  'youtube.com': 'YouTube',
  'youtu.be': 'YouTube',
  'music.youtube.com': 'YouTube Music',
  'bilibili.com': 'Bilibili',
  'b23.tv': 'Bilibili',
  'open.spotify.com': 'Spotify',
  'music.163.com': 'NetEase Music',
  'y.qq.com': 'QQ Music',
  'v.qq.com': 'Tencent Video',
  'iqiyi.com': 'iQIYI',
  'netflix.com': 'Netflix',
};

/** "YouTube" / "Bilibili" / the bare host, for the row's meta line. */
export function linkSiteName(url: string): string {
  const host = linkHost(url);
  return SITE_NAMES[host] ?? host;
}

export interface LinkHomeworkInput {
  title?: unknown;
  url?: unknown;
  instructions?: unknown;
}

export interface CleanLinkHomework {
  title: string;
  url: string;
  instructions: string | null;
  thumbnail_url: string | null;
}

/**
 * Validate a link the tutor is saving. `partial` (an update) only checks the
 * fields present. Returns the cleaned values and the problems (empty = ok).
 */
export function pickLinkHomework(input: LinkHomeworkInput, partial = false): { value: Partial<CleanLinkHomework>; problems: string[] } {
  const problems: string[] = [];
  const value: Partial<CleanLinkHomework> = {};
  if (input.url !== undefined || !partial) {
    const url = normalizeLinkUrl(input.url);
    if (!url) problems.push('url must be a web link (https://…)');
    else {
      value.url = url;
      value.thumbnail_url = linkThumbnail(url);
    }
  }
  if (input.title !== undefined || !partial) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) problems.push('title is required');
    else if (title.length > LINK_TITLE_MAX) problems.push(`title must be at most ${LINK_TITLE_MAX} characters`);
    else value.title = title;
  }
  if (input.instructions !== undefined) {
    if (input.instructions !== null && typeof input.instructions !== 'string') problems.push('instructions must be text');
    else {
      const text = (input.instructions ?? '').trim();
      if (text.length > LINK_INSTRUCTIONS_MAX) problems.push(`instructions must be at most ${LINK_INSTRUCTIONS_MAX} characters`);
      else value.instructions = text || null;
    }
  } else if (!partial) value.instructions = null;
  return { value, problems };
}

/** The student's note, trimmed and capped; null when empty. */
export function cleanLinkNote(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  return text ? text.slice(0, LINK_NOTE_MAX) : null;
}
