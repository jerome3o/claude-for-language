/**
 * The private podcast feed of audio lessons (docs/AUDIO_LESSONS.md "Podcast feed",
 * services/podcast-feed.ts).
 *
 * Public — mounted BEFORE the auth middleware; the token in the path is the credential:
 *   GET /api/podcast/:token/feed.xml                          RSS of the token's user's ready lessons
 *   GET /api/podcast/:token/lessons/:id/:version/audio.mp3    the MP3 (Range → 206, HEAD)
 *   GET /api/podcast/:token/lessons/:id/chapters.json         Podcasting 2.0 chapters
 * A wrong / reset / malformed token is a plain 404 (the same answer as a missing lesson).
 * Rate-limited per token (and per IP for unknown tokens). The token never appears in a
 * log line: the request log records the route pattern, and nothing here prints the path.
 *
 * Signed in (`podcastMe`, mounted after the auth middleware):
 *   GET    /api/me/podcast-feed        { feed } — made on first use
 *   POST   /api/me/podcast-feed/reset  { feed } with a new link; the old one stops working
 *   DELETE /api/me/podcast-feed        { ok } — the feed is off until the next GET
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import * as q from '../db/audio-lesson-queries';
import { parseByteRange, resolveServedRange } from '../services/audio';
import {
  allowRequest,
  apiOrigin,
  buildFeedXml,
  chaptersJson,
  deleteFeed,
  ensureFeed,
  findFeedByToken,
  noteFeedFetched,
  resetFeed,
  type FeedLesson,
  type PodcastFeedRow,
} from '../services/podcast-feed';
import { trackServer } from '../services/analytics/server-events';
import type { AudioLessonChapter, LessonWord } from '@shared/audio-lesson';

export const podcastPublic = new Hono<{ Bindings: Env }>();

const NOT_FOUND = () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
const TOO_MANY = () =>
  new Response('Too many requests', { status: 429, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '60', 'Cache-Control': 'no-store' } });

type FeedCtx = { env: Env; req: { header: (n: string) => string | undefined; param: (n: string) => string } };

/** The token's feed, after the rate limit; a Response when the request stops here. */
async function resolveFeed(c: FeedCtx, kind: 'feed' | 'file'): Promise<PodcastFeedRow | Response> {
  const token = c.req.param('token');
  const feed = await findFeedByToken(c.env.DB, token);
  if (!feed) {
    // Unknown tokens are limited per client address, so guessing is throttled too.
    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
    if (!(await allowRequest(c.env, `podcast-miss:${ip}`))) return TOO_MANY();
    return NOT_FOUND();
  }
  if (!(await allowRequest(c.env, `podcast-${kind}:${feed.token_hash.slice(0, 24)}`))) return TOO_MANY();
  return feed;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function feedLesson(row: q.AudioLessonRow): FeedLesson | null {
  const version = q.audioVersion(row);
  if (row.status !== 'ready' || !row.audio_key || !version) return null;
  const timeline = parseJson<{ chapters?: AudioLessonChapter[] }>(row.timeline_json, {});
  return {
    id: row.id,
    format: row.format,
    title: row.title,
    version,
    size_bytes: row.size_bytes ?? 0,
    duration_ms: row.duration_ms ?? 0,
    words: parseJson<LessonWord[]>(row.words_json, []),
    chapters: timeline.chapters ?? [],
    published_at: row.finished_at ?? row.created_at,
  };
}

podcastPublic.get('/:token/feed.xml', async (c) => {
  const feed = await resolveFeed(c, 'feed');
  if (feed instanceof Response) return feed;
  const [rows, owner] = await Promise.all([
    q.listReadyAudioLessons(c.env.DB, feed.user_id),
    c.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(feed.user_id).first<{ name: string | null }>(),
  ]);
  const lessons = rows.map(feedLesson).filter((l): l is FeedLesson => !!l);
  const xml = buildFeedXml({ origin: apiOrigin(c.env, c.req.url), token: c.req.param('token'), ownerName: owner?.name ?? '', lessons });
  c.executionCtx.waitUntil(
    Promise.all([
      noteFeedFetched(c.env.DB, feed.user_id),
      trackServer('server.podcast_feed_fetched', { items: lessons.length }, { env: c.env, userId: feed.user_id }),
    ]).catch(() => {}),
  );
  return new Response(c.req.method === 'HEAD' ? null : xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      // Private: never in a shared cache; podcast apps poll, a minute is plenty.
      'Cache-Control': 'private, max-age=60',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    },
  });
});

podcastPublic.get('/:token/lessons/:id/chapters.json', async (c) => {
  const feed = await resolveFeed(c, 'file');
  if (feed instanceof Response) return feed;
  const row = await q.getAudioLesson(c.env.DB, c.req.param('id'), feed.user_id);
  const lesson = row ? feedLesson(row) : null;
  if (!lesson) return NOT_FOUND();
  return new Response(JSON.stringify(chaptersJson(lesson)), {
    headers: { 'Content-Type': 'application/json+chapters; charset=utf-8', 'Cache-Control': 'private, max-age=3600', 'X-Robots-Tag': 'noindex' },
  });
});

podcastPublic.get('/:token/lessons/:id/:version/audio.mp3', async (c) => {
  const feed = await resolveFeed(c, 'file');
  if (feed instanceof Response) return feed;
  // Scoped to the token's user: another user's lesson id is simply not found.
  const row = await q.getAudioLesson(c.env.DB, c.req.param('id'), feed.user_id);
  if (!row?.audio_key || row.status !== 'ready' || q.audioVersion(row) !== c.req.param('version')) return NOT_FOUND();
  const head = await c.env.AUDIO_BUCKET.head(row.audio_key);
  if (!head) return NOT_FOUND();
  const size = head.size;
  const headers = new Headers();
  headers.set('Content-Type', 'audio/mpeg');
  headers.set('Accept-Ranges', 'bytes');
  // The version is in the path: the file at this URL never changes.
  headers.set('Cache-Control', 'private, max-age=31536000, immutable');
  headers.set('ETag', `"${head.etag}"`);
  headers.set('X-Robots-Tag', 'noindex');
  headers.set('Content-Disposition', `inline; filename="${row.id}.mp3"`);

  const rangeHeader = c.req.header('Range');
  const range = parseByteRange(rangeHeader);
  if (rangeHeader && range) {
    const start = 'suffix' in range ? Math.max(0, size - range.suffix) : range.offset ?? 0;
    if (start >= size) {
      headers.set('Content-Range', `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    // Clamp an end past the file (players ask for "bytes=0-99999999").
    const clamped = 'suffix' in range ? range : { offset: start, length: Math.min(range.length ?? size - start, size - start) };
    if (c.req.method === 'HEAD') {
      const served = resolveServedRange(clamped, size)!;
      headers.set('Content-Length', String(served.length));
      headers.set('Content-Range', `bytes ${served.offset}-${served.offset + served.length - 1}/${size}`);
      return new Response(null, { status: 206, headers });
    }
    const object = await c.env.AUDIO_BUCKET.get(row.audio_key, { range: clamped });
    if (!object) return NOT_FOUND();
    // Always 206 for a valid Range (AVPlayer / ExoPlayer expect it even for "bytes=0-").
    const served = resolveServedRange(object.range, size) ?? resolveServedRange(clamped, size)!;
    headers.set('Content-Length', String(served.length));
    headers.set('Content-Range', `bytes ${served.offset}-${served.offset + served.length - 1}/${size}`);
    return new Response(object.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(size));
  if (c.req.method === 'HEAD') return new Response(null, { headers });
  const object = await c.env.AUDIO_BUCKET.get(row.audio_key);
  if (!object) return NOT_FOUND();
  return new Response(object.body, { headers });
});

// Everything else under /api/podcast: the same 404 (and no SPA fallback).
podcastPublic.all('*', () => NOT_FOUND());

// ---------------- Signed in ----------------

export const podcastMe = new Hono<{ Bindings: Env }>();

function userId(c: { get: (k: 'user') => { id: string } | undefined }): string | null {
  return c.get('user')?.id ?? null;
}

podcastMe.get('/me/podcast-feed', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const feed = await ensureFeed(c.env, uid, apiOrigin(c.env, c.req.url));
  c.header('Cache-Control', 'no-store');
  return c.json({ feed });
});

podcastMe.post('/me/podcast-feed/reset', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const feed = await resetFeed(c.env, uid, apiOrigin(c.env, c.req.url));
  c.header('Cache-Control', 'no-store');
  return c.json({ feed });
});

podcastMe.delete('/me/podcast-feed', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  await deleteFeed(c.env.DB, uid);
  return c.json({ ok: true });
});
