/**
 * Private podcast feed of a user's audio lessons (docs/AUDIO_LESSONS.md "Podcast feed").
 *
 *   GET /api/podcast/<token>/feed.xml                          RSS 2.0 + iTunes + Podcasting 2.0 chapters
 *   GET /api/podcast/<token>/lessons/<id>/<version>/audio.mp3  the lesson's MP3 (Range → 206)
 *   GET /api/podcast/<token>/lessons/<id>/chapters.json        JSON chapters (podcast:chapters)
 *
 * The token is the only credential (a podcast app cannot sign in), so:
 * - it is 32 random bytes (base64url, 43 characters) and never stored in clear: D1 keeps its
 *   SHA-256 (`token_hash`, how a request finds its user) and an AES-GCM encryption of it
 *   (`token_enc`, key derived from SESSION_SECRET) so Settings can show the same link again;
 * - it grants exactly ONE user's ready lessons and nothing else — every lookup is by the
 *   token's user id;
 * - Reset makes a new token (the old link stops working at once), Turn off deletes the row;
 * - it is never logged: the request log line carries the route PATTERN (`:token`), and this
 *   module never prints it.
 */
import type { Env } from '../types';
import type { AudioLessonChapter, AudioLessonFormat, LessonWord, PodcastFeedInfo } from '@shared/audio-lesson';

export type { PodcastFeedInfo };
import { chapterTitleWithPinyin, formatClock } from '@shared/audio-lesson';
import { APP_BASE_URL } from './email';

export interface PodcastFeedRow {
  user_id: string;
  token_hash: string;
  token_enc: string;
  created_at: string;
  rotated_at: string | null;
  last_fetched_at: string | null;
  fetch_count: number;
}

type SecretEnv = Pick<Env, 'SESSION_SECRET' | 'GOOGLE_CLIENT_SECRET' | 'E2E_TEST_MODE'>;

const TOKEN_BYTES = 32;
/** base64url of 32 bytes = 43 characters; anything else is refused before the database is asked. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function newFeedToken(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

export async function hashFeedToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`podcast-feed:${token}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function secretFor(env: SecretEnv): string {
  if (env.SESSION_SECRET) return `podcast-feed:${env.SESSION_SECRET}`;
  if (env.GOOGLE_CLIENT_SECRET) return `podcast-feed:${env.GOOGLE_CLIENT_SECRET}`;
  if (env.E2E_TEST_MODE === 'true') return 'dev-only-podcast-feed-secret';
  throw new Error('SESSION_SECRET is not set');
}

async function aesKey(env: SecretEnv): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secretFor(env)));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** `v1.<iv>.<ciphertext>` (base64url). */
export async function encryptFeedToken(env: SecretEnv, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), new TextEncoder().encode(token));
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

export async function decryptFeedToken(env: SecretEnv, stored: string): Promise<string | null> {
  try {
    const [v, iv, ct] = stored.split('.');
    if (v !== 'v1' || !iv || !ct) return null;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, await aesKey(env), fromB64url(ct));
    const token = new TextDecoder().decode(pt);
    return TOKEN_PATTERN.test(token) ? token : null;
  } catch {
    return null;
  }
}

// ---------------- URLs ----------------

/** The public origin of this worker (feed + enclosure URLs point at it). */
export function apiOrigin(env: Pick<Env, 'PUBLIC_API_URL'>, requestUrl: string): string {
  return (env.PUBLIC_API_URL || new URL(requestUrl).origin).replace(/\/+$/, '');
}

export function feedUrl(origin: string, token: string): string {
  return `${origin}/api/podcast/${token}/feed.xml`;
}

export function enclosureUrl(origin: string, token: string, lessonId: string, version: string): string {
  return `${origin}/api/podcast/${token}/lessons/${encodeURIComponent(lessonId)}/${encodeURIComponent(version)}/audio.mp3`;
}

export function chaptersUrl(origin: string, token: string, lessonId: string): string {
  return `${origin}/api/podcast/${token}/lessons/${encodeURIComponent(lessonId)}/chapters.json`;
}

/** podcast://host/path (AntennaPod, Pocket Casts, Podcast Addict) and pcast://host/path (Apple Podcasts). */
export function subscribeUrls(url: string): { podcast_url: string; apple_url: string } {
  const rest = url.replace(/^https?:\/\//, '');
  return { podcast_url: `podcast://${rest}`, apple_url: `pcast://${rest}` };
}

// ---------------- Rows ----------------

export async function getFeedRow(db: D1Database, userId: string): Promise<PodcastFeedRow | null> {
  return db.prepare('SELECT * FROM podcast_feeds WHERE user_id = ?').bind(userId).first<PodcastFeedRow>();
}

/** The user a token belongs to, or null (a malformed token never reaches the database). */
export async function findFeedByToken(db: D1Database, token: string): Promise<PodcastFeedRow | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  return db.prepare('SELECT * FROM podcast_feeds WHERE token_hash = ?').bind(await hashFeedToken(token)).first<PodcastFeedRow>();
}

async function infoFor(env: SecretEnv, row: PodcastFeedRow, origin: string, token?: string): Promise<PodcastFeedInfo> {
  const t = token ?? (await decryptFeedToken(env, row.token_enc));
  const url = t ? feedUrl(origin, t) : null;
  const sub = url ? subscribeUrls(url) : null;
  return {
    url,
    podcast_url: sub?.podcast_url ?? null,
    apple_url: sub?.apple_url ?? null,
    created_at: row.created_at,
    rotated_at: row.rotated_at,
    last_fetched_at: row.last_fetched_at,
    fetch_count: row.fetch_count ?? 0,
  };
}

/** The user's feed, made on first use (idempotent). */
export async function ensureFeed(env: Env, userId: string, origin: string): Promise<PodcastFeedInfo> {
  const existing = await getFeedRow(env.DB, userId);
  if (existing) return infoFor(env, existing, origin);
  const token = newFeedToken();
  const now = new Date().toISOString();
  await env.DB.prepare('INSERT OR IGNORE INTO podcast_feeds (user_id, token_hash, token_enc, created_at) VALUES (?, ?, ?, ?)')
    .bind(userId, await hashFeedToken(token), await encryptFeedToken(env, token), now)
    .run();
  const row = await getFeedRow(env.DB, userId);
  if (!row) throw new Error('podcast feed not created');
  // Another request may have won the insert: then its token is the one stored.
  return infoFor(env, row, origin, row.token_hash === (await hashFeedToken(token)) ? token : undefined);
}

/** A new token: the old link (feed and files) stops working at once. */
export async function resetFeed(env: Env, userId: string, origin: string): Promise<PodcastFeedInfo> {
  const token = newFeedToken();
  const now = new Date().toISOString();
  const hash = await hashFeedToken(token);
  const enc = await encryptFeedToken(env, token);
  await env.DB.prepare(
    `INSERT INTO podcast_feeds (user_id, token_hash, token_enc, created_at, rotated_at) VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT(user_id) DO UPDATE SET token_hash = ?2, token_enc = ?3, rotated_at = ?4, last_fetched_at = NULL, fetch_count = 0`,
  )
    .bind(userId, hash, enc, now)
    .run();
  const row = await getFeedRow(env.DB, userId);
  return infoFor(env, row!, origin, token);
}

export async function deleteFeed(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM podcast_feeds WHERE user_id = ?').bind(userId).run();
}

export async function noteFeedFetched(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare('UPDATE podcast_feeds SET last_fetched_at = ?, fetch_count = fetch_count + 1 WHERE user_id = ?')
    .bind(new Date().toISOString(), userId)
    .run();
}

// ---------------- Rate limit ----------------

export interface RateLimiterBinding {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

/** Requests per minute per key when the Workers rate-limit binding is missing (dev, tests). */
export const FALLBACK_LIMIT_PER_MINUTE = 120;
const memoryWindows = new Map<string, { start: number; count: number }>();

/**
 * One request against `key` (a token hash prefix, or the IP for unknown tokens): the
 * `PODCAST_RATE_LIMITER` binding (wrangler.toml, 120 / 60 s) when present, else a
 * per-isolate fixed window with the same numbers.
 */
export async function allowRequest(env: { PODCAST_RATE_LIMITER?: RateLimiterBinding }, key: string, now = Date.now()): Promise<boolean> {
  if (env.PODCAST_RATE_LIMITER) {
    try {
      return (await env.PODCAST_RATE_LIMITER.limit({ key })).success;
    } catch {
      // the limiter itself failing must not take the feed down — fall back to memory
    }
  }
  const w = memoryWindows.get(key);
  if (!w || now - w.start >= 60_000) {
    if (memoryWindows.size > 5000) memoryWindows.clear();
    memoryWindows.set(key, { start: now, count: 1 });
    return true;
  }
  w.count += 1;
  return w.count <= FALLBACK_LIMIT_PER_MINUTE;
}

/** Tests only. */
export function resetMemoryRateLimits(): void {
  memoryWindows.clear();
}

// ---------------- The feed ----------------

export interface FeedLesson {
  id: string;
  format: AudioLessonFormat;
  title: string;
  version: string;
  size_bytes: number;
  duration_ms: number;
  words: LessonWord[];
  chapters: AudioLessonChapter[];
  /** ISO. */
  published_at: string;
}

export function escapeXml(s: string): string {
  // Strip characters XML 1.0 forbids, then escape.
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

/** RFC 822 date (RSS pubDate). */
export function rfc822(iso: string): string {
  const d = new Date(iso);
  return (Number.isNaN(d.getTime()) ? new Date(0) : d).toUTCString();
}

/** iTunes duration: HH:MM:SS. */
export function itunesDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

/**
 * The episode notes: what it teaches, then the chapters as timestamps (podcast apps make them
 * tappable). Chapter titles carry their pinyin ("打扰了 dǎrǎo le — sorry to bother you").
 */
export function episodeDescription(l: FeedLesson): string {
  const lines: string[] = [];
  lines.push(
    l.format === 'sleep'
      ? 'Sleep lesson — slow Chinese to fall asleep to.'
      : l.format === 'story'
        ? 'Listen & repeat — a story or conversation, each line three times slowly, then its English.'
        : 'Dialogue lesson — a Chinese conversation, explained in English.',
  );
  if (l.words.length) {
    lines.push('');
    lines.push(`Words (${l.words.length}):`);
    for (const w of l.words.slice(0, 30)) lines.push(`${w.hanzi} ${w.pinyin} — ${w.english}`);
  }
  if (l.chapters.length) {
    lines.push('');
    lines.push('Chapters:');
    for (const c of l.chapters) lines.push(`${formatClock(c.start_ms)} ${chapterTitleWithPinyin(c.title, l.words)}`);
  }
  return lines.join('\n');
}

/**
 * Podcasting 2.0 JSON chapters (https://github.com/Podcastindex-org/podcast-namespace/blob/main/chapters/jsonChapters.md).
 * Titles with their pinyin, from the lesson's words (else automatic) — made on request, so older
 * episodes get it too (the MP3 itself carries no ID3 chapters).
 */
export function chaptersJson(l: Pick<FeedLesson, 'title' | 'chapters'> & { words?: LessonWord[] }): { version: string; title: string; chapters: Array<{ startTime: number; title: string }> } {
  return { version: '1.2.0', title: l.title, chapters: l.chapters.map((c) => ({ startTime: Math.round(c.start_ms) / 1000, title: chapterTitleWithPinyin(c.title, l.words ?? []) })) };
}

export function buildFeedXml(args: { origin: string; token: string; ownerName: string; lessons: FeedLesson[]; now?: Date }): string {
  const { origin, token, lessons } = args;
  const self = feedUrl(origin, token);
  const link = `${APP_BASE_URL}/audio-lessons`;
  const title = `Chinese audio lessons${args.ownerName ? ` — ${args.ownerName}` : ''}`;
  const summary = 'Your audio lessons from the Chinese learning app: dialogue lessons for the train, slow sleep lessons and stories to listen to and repeat. Private to you — do not share this feed link.';
  const lastBuild = lessons.length ? rfc822(lessons.reduce((a, l) => (l.published_at > a ? l.published_at : a), lessons[0].published_at)) : (args.now ?? new Date()).toUTCString();
  const image = `${APP_BASE_URL}/podcast-artwork.jpg`;
  const items = lessons.map((l) => {
    const desc = episodeDescription(l);
    return [
      '    <item>',
      `      <title>${escapeXml(l.title)}</title>`,
      `      <description>${escapeXml(desc)}</description>`,
      `      <itunes:summary>${escapeXml(desc)}</itunes:summary>`,
      `      <pubDate>${rfc822(l.published_at)}</pubDate>`,
      `      <guid isPermaLink="false">audio-lesson-${escapeXml(l.id)}-${escapeXml(l.version)}</guid>`,
      `      <link>${escapeXml(`${APP_BASE_URL}/audio-lessons/${encodeURIComponent(l.id)}`)}</link>`,
      `      <enclosure url="${escapeXml(enclosureUrl(origin, token, l.id, l.version))}" length="${Math.max(0, Math.round(l.size_bytes))}" type="audio/mpeg"/>`,
      `      <itunes:duration>${itunesDuration(l.duration_ms)}</itunes:duration>`,
      `      <itunes:episodeType>full</itunes:episodeType>`,
      `      <itunes:explicit>false</itunes:explicit>`,
      ...(l.chapters.length ? [`      <podcast:chapters url="${escapeXml(chaptersUrl(origin, token, l.id))}" type="application/json+chapters"/>`] : []),
      '    </item>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:podcast="https://podcastindex.org/namespace/1.0">',
    '  <channel>',
    `    <title>${escapeXml(title)}</title>`,
    `    <link>${escapeXml(link)}</link>`,
    `    <atom:link href="${escapeXml(self)}" rel="self" type="application/rss+xml"/>`,
    `    <description>${escapeXml(summary)}</description>`,
    '    <language>zh-cn</language>',
    `    <lastBuildDate>${lastBuild}</lastBuildDate>`,
    '    <generator>Chinese learning app</generator>',
    `    <itunes:author>${escapeXml(args.ownerName || 'Chinese learning app')}</itunes:author>`,
    `    <itunes:summary>${escapeXml(summary)}</itunes:summary>`,
    `    <itunes:image href="${escapeXml(image)}"/>`,
    `    <image><url>${escapeXml(image)}</url><title>${escapeXml(title)}</title><link>${escapeXml(link)}</link></image>`,
    '    <itunes:category text="Education"><itunes:category text="Language Learning"/></itunes:category>',
    '    <itunes:explicit>false</itunes:explicit>',
    '    <itunes:type>episodic</itunes:type>',
    // Private: keep it out of Apple's directory (and any directory that honours these).
    '    <itunes:block>Yes</itunes:block>',
    '    <podcast:locked>yes</podcast:locked>',
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}
