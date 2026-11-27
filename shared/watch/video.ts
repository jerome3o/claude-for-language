/**
 * 📺 Watch (追剧, docs/WATCH.md): which YouTube video a pasted / shared link means. Public
 * YouTube videos only, played in YouTube's own embedded player — we never download, proxy or
 * extract YouTube media. Ported to android-lab/core (watch/Watch.kt), parity-tested
 * (android-lab/parity/fixtures/watch.ts).
 */

/** A YouTube video id: 11 characters of [A-Za-z0-9_-]. */
const ID = /^[A-Za-z0-9_-]{11}$/;

const YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

/** The first http(s) link inside a piece of text (YouTube's Share sends "Title https://youtu.be/…"). */
export function firstUrlIn(text: string): string | null {
  const m = /https?:\/\/[^\s<>"'“”]+/i.exec(text);
  if (!m) return null;
  return m[0].replace(/[),.;!?，。）]+$/u, '');
}

/**
 * The video id of a YouTube link (watch?v=, youtu.be/, /shorts/, /embed/, /live/, /v/, m. and
 * music. hosts, youtube-nocookie.com), of a share text containing one, or a bare 11-character id.
 * Null for anything else (a channel, a playlist without a video, another site).
 */
export function parseYouTubeVideoId(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  if (ID.test(raw)) return raw;
  let candidate = firstUrlIn(raw);
  if (!candidate) {
    // "youtu.be/abc…" or "www.youtube.com/watch?v=…" pasted without the scheme.
    const bare = /(?:^|\s)((?:[a-z]+\.)?(?:youtube(?:-nocookie)?\.com|youtu\.be)\/\S+)/i.exec(raw);
    if (!bare) return null;
    candidate = `https://${bare[1]}`;
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  let id: string | null = null;
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    id = parts[0] ?? null;
  } else if (YT_HOSTS.has(host)) {
    if (parts[0] === 'watch') id = url.searchParams.get('v');
    else if (parts.length === 0) id = url.searchParams.get('v');
    else if (['shorts', 'embed', 'live', 'v', 'e'].includes(parts[0])) id = parts[1] ?? null;
    else if (parts[0] === 'attribution_link') {
      const inner = url.searchParams.get('u');
      if (inner) {
        try {
          id = new URL(inner, 'https://www.youtube.com').searchParams.get('v');
        } catch {
          id = null;
        }
      }
    }
  }
  return id && ID.test(id) ? id : null;
}

/** The video's page on YouTube ("Open on YouTube", the Gemini request). */
export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** YouTube's public thumbnail (the only picture of a video we show; 320×180). */
export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

/** A YouTube search ("Find on YouTube"). */
export function youtubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

/** Jerome's shows (all on YouTube with burned-in Chinese subtitles) — the list page's "Find on YouTube" links. */
export interface WatchShow {
  title: string;
  english: string;
  year: number;
  query: string;
  note: string;
}

export const WATCH_SHOWS: readonly WatchShow[] = [
  { title: '小欢喜', english: 'A Little Reunion', year: 2019, query: '小欢喜 第1集', note: 'Start here — three families in an exam year; everyday Mandarin at home and school.' },
  { title: '欢乐颂', english: 'Ode to Joy', year: 2016, query: '欢乐颂 第1集', note: 'Five neighbours on one floor in Shanghai; office and flat-share Mandarin.' },
  { title: '三十而已', english: 'Nothing But Thirty', year: 2020, query: '三十而已 第1集', note: 'Three friends turning thirty; fast, natural conversation.' },
  { title: '开端', english: 'Reset', year: 2022, query: '开端 第1集', note: 'A time-loop thriller on a bus; short episodes, lots of repeated lines.' },
  { title: '繁花', english: 'Blossoms Shanghai', year: 2023, query: '繁花 普通话版 第1集', note: 'Mostly spoken in Shanghainese (沪语) — look for the 普通话版 (Mandarin) version, or lean on the subtitles.' },
];
