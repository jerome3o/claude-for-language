/**
 * Podcast feeds (docs/PODCASTS.md): fetch a public RSS feed and read its episodes.
 *
 * Fetching follows the link-preview safety rules (services/link-preview.ts `safePreviewUrl`):
 * public http(s) only, no credentials / odd ports / private or local hosts — checked again on
 * EVERY redirect hop (redirects are followed by hand, at most 5) — a 10 s timeout and at most
 * 8 MB read. An Apple Podcasts page link is turned into its feed with Apple's public lookup
 * API, and a web page that announces its feed (`<link rel="alternate" type="application/rss+xml">`)
 * is followed once.
 *
 * Parsing is a small tolerant reader for RSS 2.0 + the iTunes tags (and Atom, rarely used for
 * podcasts): CDATA, entities, missing fields, durations as "1:02:03" / "62:03" / "3723".
 */
import { safePreviewUrl } from '../link-preview';

export interface PodcastEpisodeInfo {
  /** Stable per feed: the guid, else the enclosure URL. */
  guid: string;
  title: string;
  published_at: string | null;
  duration_s: number | null;
  enclosure_url: string;
  enclosure_type: string | null;
  enclosure_bytes: number | null;
  image_url: string | null;
  /** Plain text, at most 600 characters. */
  description: string;
  link: string | null;
}

export interface PodcastFeed {
  feed_url: string;
  title: string;
  author: string | null;
  image_url: string | null;
  description: string;
  link: string | null;
  language: string | null;
  episodes: PodcastEpisodeInfo[];
}

export const MAX_FEED_BYTES = 8 * 1024 * 1024;
export const MAX_EPISODES = 300;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

export class FeedError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 502 = 502) {
    super(message);
  }
}

// ---------------------------------------------------------------- text helpers

export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function safeCodePoint(n: number): string {
  try {
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  } catch {
    return '';
  }
}

/** The text of an element body: CDATA unwrapped, entities decoded (CDATA content is literal). */
function textOf(raw: string): string {
  let out = '';
  let rest = raw;
  for (;;) {
    const i = rest.indexOf('<![CDATA[');
    if (i < 0) {
      out += decodeXmlEntities(rest);
      break;
    }
    out += decodeXmlEntities(rest.slice(0, i));
    const end = rest.indexOf(']]>', i + 9);
    if (end < 0) {
      out += rest.slice(i + 9);
      break;
    }
    out += rest.slice(i + 9, end);
    rest = rest.slice(end + 3);
  }
  return out;
}

/** A title: one line, at most `max` characters (its text is already decoded; never tag-stripped — "<世界>" is a title). */
function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

/** HTML show notes → one line of plain text. */
export function plainText(html: string, max = 600): string {
  const t = decodeXmlEntities(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The first `<tag …>body</tag>` (tag may carry a namespace prefix, e.g. itunes:duration). */
function element(xml: string, tag: string): { attrs: string; body: string } | null {
  const re = new RegExp(`<${escapeRe(tag)}(\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${escapeRe(tag)}\\s*>)`, 'i');
  const m = re.exec(xml);
  return m ? { attrs: m[1] ?? '', body: m[2] ?? '' } : null;
}

function child(xml: string, tag: string): string | null {
  const el = element(xml, tag);
  if (!el) return null;
  const t = textOf(el.body).trim();
  return t || null;
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${escapeRe(name)}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  if (!m) return null;
  const v = decodeXmlEntities(m[2] ?? m[3] ?? '').trim();
  return v || null;
}

/** "1:02:03" / "62:03" / "3723" / "3723.5" → seconds; null when unreadable. */
export function parseDuration(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Math.round(Number(s));
    return n > 0 ? n : null;
  }
  const parts = s.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p.trim()))) return null;
  const nums = parts.map((p) => Number(p.trim()));
  const secs = nums.length === 3 ? nums[0] * 3600 + nums[1] * 60 + nums[2] : nums[0] * 60 + nums[1];
  return secs > 0 ? Math.round(secs) : null;
}

function isoDate(raw: string | null): string | null {
  if (!raw) return null;
  const t = Date.parse(raw.trim());
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function absUrl(raw: string | null, base: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim(), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- parsing

function blocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}\\s*>`, 'gi');
  for (const m of xml.matchAll(re)) {
    out.push(m[1]);
    if (out.length >= MAX_EPISODES) break;
  }
  return out;
}

function imageOf(xml: string, base: string): string | null {
  const it = element(xml, 'itunes:image');
  const href = it ? attr(it.attrs, 'href') : null;
  if (href) return absUrl(href, base);
  const img = element(xml, 'image');
  if (img) return absUrl(child(img.body, 'url') ?? attr(img.attrs, 'href'), base);
  const media = element(xml, 'media:thumbnail');
  return media ? absUrl(attr(media.attrs, 'url'), base) : null;
}

function rssItem(item: string, base: string, channelImage: string | null): PodcastEpisodeInfo | null {
  // The enclosure: <enclosure url length type/>, else a <media:content url type="audio/…">.
  const enc = element(item, 'enclosure');
  let url = enc ? absUrl(attr(enc.attrs, 'url'), base) : null;
  let type = enc ? attr(enc.attrs, 'type') : null;
  let length = enc ? Number(attr(enc.attrs, 'length') ?? '') : NaN;
  if (!url) {
    const media = element(item, 'media:content');
    if (media) {
      url = absUrl(attr(media.attrs, 'url'), base);
      type = attr(media.attrs, 'type');
      length = Number(attr(media.attrs, 'fileSize') ?? '');
    }
  }
  if (!url) return null;
  // Only audio (a video podcast's episode would be far too big); a missing type is assumed audio.
  if (type && !/^audio\//i.test(type) && !/mpeg|mp3|m4a|aac|ogg/i.test(type)) return null;
  const title = child(item, 'title') ?? child(item, 'itunes:title') ?? 'Untitled episode';
  const description = plainText(child(item, 'itunes:summary') ?? child(item, 'description') ?? child(item, 'content:encoded') ?? '');
  return {
    guid: child(item, 'guid') ?? url,
    title: oneLine(title, 300),
    published_at: isoDate(child(item, 'pubDate') ?? child(item, 'dc:date')),
    duration_s: parseDuration(child(item, 'itunes:duration')),
    enclosure_url: url,
    enclosure_type: type,
    enclosure_bytes: Number.isFinite(length) && length > 0 ? length : null,
    image_url: imageOf(item, base) ?? channelImage,
    description,
    link: absUrl(child(item, 'link'), base),
  };
}

function atomEntry(entry: string, base: string, channelImage: string | null): PodcastEpisodeInfo | null {
  let url: string | null = null;
  let type: string | null = null;
  let length = NaN;
  for (const m of entry.matchAll(/<link\b([^>]*)\/?>/gi)) {
    if ((attr(m[1], 'rel') ?? '').toLowerCase() !== 'enclosure') continue;
    url = absUrl(attr(m[1], 'href'), base);
    type = attr(m[1], 'type');
    length = Number(attr(m[1], 'length') ?? '');
    break;
  }
  if (!url) return null;
  return {
    guid: child(entry, 'id') ?? url,
    title: oneLine(child(entry, 'title') ?? 'Untitled episode', 300),
    published_at: isoDate(child(entry, 'published') ?? child(entry, 'updated')),
    duration_s: parseDuration(child(entry, 'itunes:duration')),
    enclosure_url: url,
    enclosure_type: type,
    enclosure_bytes: Number.isFinite(length) && length > 0 ? length : null,
    image_url: channelImage,
    description: plainText(child(entry, 'summary') ?? child(entry, 'content') ?? ''),
    link: null,
  };
}

/**
 * The feed from its XML. Throws FeedError(400) when the document is no podcast feed (no
 * channel / feed element, or not one audio episode).
 */
export function parseFeed(xml: string, feedUrl: string): PodcastFeed {
  const doc = xml.replace(/^﻿/, '');
  const channel = element(doc, 'channel');
  if (channel) {
    // Channel-level fields come from before the first <item> (an item's <title> must not win).
    const head = channel.body.split(/<item[\s>]/i)[0];
    const image = imageOf(head, feedUrl);
    const episodes = blocks(channel.body, 'item').map((i) => rssItem(i, feedUrl, image)).filter((e): e is PodcastEpisodeInfo => !!e);
    if (!episodes.length) throw new FeedError('This feed has no audio episodes', 400);
    return {
      feed_url: feedUrl,
      title: oneLine(child(head, 'title') ?? 'Untitled podcast', 200),
      author: child(head, 'itunes:author') ? oneLine(child(head, 'itunes:author')!, 120) : null,
      image_url: image,
      description: plainText(child(head, 'itunes:summary') ?? child(head, 'description') ?? ''),
      link: absUrl(child(head, 'link'), feedUrl),
      language: child(head, 'language'),
      episodes: dedupeByGuid(episodes),
    };
  }
  const feed = element(doc, 'feed');
  if (feed) {
    const head = feed.body.split(/<entry[\s>]/i)[0];
    const image = absUrl(child(head, 'logo') ?? child(head, 'icon'), feedUrl) ?? imageOf(head, feedUrl);
    const episodes = blocks(feed.body, 'entry').map((e) => atomEntry(e, feedUrl, image)).filter((e): e is PodcastEpisodeInfo => !!e);
    if (!episodes.length) throw new FeedError('This feed has no audio episodes', 400);
    return {
      feed_url: feedUrl,
      title: oneLine(child(head, 'title') ?? 'Untitled podcast', 200),
      author: child(head, 'name'),
      image_url: image,
      description: plainText(child(head, 'subtitle') ?? ''),
      link: null,
      language: null,
      episodes: dedupeByGuid(episodes),
    };
  }
  throw new FeedError("That link isn't a podcast feed (RSS)", 400);
}

function dedupeByGuid(episodes: PodcastEpisodeInfo[]): PodcastEpisodeInfo[] {
  const seen = new Set<string>();
  return episodes.filter((e) => (seen.has(e.guid) ? false : (seen.add(e.guid), true)));
}

/** A web page's announced feed (`<link rel="alternate" type="application/rss+xml" href>`), if any. */
export function discoverFeedLink(html: string, pageUrl: string): string | null {
  for (const m of html.slice(0, 256 * 1024).matchAll(/<link\b([^>]*)>/gi)) {
    const rel = (attr(m[1], 'rel') ?? '').toLowerCase();
    const type = (attr(m[1], 'type') ?? '').toLowerCase();
    if (rel.includes('alternate') && /rss|atom/.test(type)) return absUrl(attr(m[1], 'href'), pageUrl);
  }
  return null;
}

/** "https://podcasts.apple.com/us/podcast/name/id1234567890" → "1234567890". */
export function applePodcastId(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!/(^|\.)podcasts\.apple\.com$|(^|\.)itunes\.apple\.com$/.test(u.hostname)) return null;
    return /\/id(\d{5,15})(?:$|[/?])/.exec(u.pathname + '/')?.[1] ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- fetching

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** GET with every redirect hop checked against the safety rules; the final URL + response. */
export async function safeFetch(raw: string, fetcher: Fetcher, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<{ url: string; res: Response }> {
  let url = safePreviewUrl(raw.trim());
  if (!url) throw new FeedError('Only public http(s) links can be used', 400);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetcher(url.toString(), { ...init, redirect: 'manual', signal: ctrl.signal });
      if (res.status >= 300 && res.status < 400 && res.headers.get('Location')) {
        const next = safePreviewUrl(new URL(res.headers.get('Location')!, url).toString());
        await res.body?.cancel().catch(() => {});
        if (!next) throw new FeedError('The link redirects somewhere that can\'t be fetched', 400);
        url = next;
        continue;
      }
      return { url: url.toString(), res };
    }
    throw new FeedError('Too many redirects');
  } catch (err) {
    if (err instanceof FeedError) throw err;
    throw new FeedError(ctrl.signal.aborted ? 'The feed took too long to answer' : `Couldn't fetch the feed (${err instanceof Error ? err.message : String(err)})`);
  } finally {
    clearTimeout(timer);
  }
}

export async function readTextCapped(res: Response, max = MAX_FEED_BYTES): Promise<string> {
  const declared = Number(res.headers.get('Content-Length') ?? '');
  if (Number.isFinite(declared) && declared > max) throw new FeedError('The feed is too big (over 8 MB)');
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new FeedError('The feed is too big (over 8 MB)');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(all);
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; ChineseLearningPodcasts/1.0)',
  Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
};

/** Fetch + parse a feed from what the learner pasted (an RSS link, an Apple Podcasts link, or the show's web page). */
export async function fetchFeed(raw: string, fetcher: Fetcher = fetch): Promise<PodcastFeed> {
  let target = raw.trim();
  const appleId = applePodcastId(target);
  if (appleId) {
    const { res } = await safeFetch(`https://itunes.apple.com/lookup?id=${appleId}&entity=podcast`, fetcher);
    if (!res.ok) throw new FeedError(`Apple Podcasts didn't answer (HTTP ${res.status})`);
    const data = JSON.parse(await readTextCapped(res, 512 * 1024)) as { results?: Array<{ feedUrl?: string }> };
    const feedUrl = data.results?.find((r) => r.feedUrl)?.feedUrl;
    if (!feedUrl) throw new FeedError('Apple Podcasts has no public feed for this show', 404);
    target = feedUrl;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const { url, res } = await safeFetch(target, fetcher, { headers: HEADERS });
    if (res.status === 404 || res.status === 410) throw new FeedError('No feed at that link (404)', 404);
    if (!res.ok) throw new FeedError(`The feed's server answered HTTP ${res.status}`);
    const body = await readTextCapped(res);
    const looksHtml = /^\s*(<!doctype html|<html)/i.test(body.slice(0, 500));
    if (looksHtml && attempt === 0) {
      const link = discoverFeedLink(body, url);
      if (link) {
        target = link;
        continue;
      }
      throw new FeedError("That page doesn't link to a podcast feed — paste the RSS link", 400);
    }
    // The feed is known by the link asked for (stable across the host's redirects).
    return parseFeed(body, target);
  }
  throw new FeedError("That link isn't a podcast feed (RSS)", 400);
}
