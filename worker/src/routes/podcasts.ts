/**
 * Podcasts (docs/PODCASTS.md): subscribe to Chinese podcasts by RSS, browse their episodes, and
 * have one transcribed into segments to listen to one at a time — the Lab app's 🎙 Podcasts.
 * Not the private RSS feed of a learner's own audio lessons (routes/podcast.ts).
 *
 * Signed in (mounted under /api after the auth middleware):
 *   GET    /api/podcasts                         subscriptions + suggested + my episodes + transcription_available
 *   POST   /api/podcasts/subscriptions           { url } (RSS, Apple Podcasts link or the show's page) → 201 { subscription, feed }
 *   DELETE /api/podcasts/subscriptions/:id
 *   GET    /api/podcasts/feed?url=&refresh=1     the feed + each episode's transcription status
 *   POST   /api/podcasts/episodes                { feed_url, guid } → 202 { episode } (200 when it exists already)
 *   GET    /api/podcasts/episodes/:id            the episode with its segments once transcribed
 *   GET    /api/podcasts/episodes/:id/audio      the copy we transcribed (Range → 206)
 *   POST   /api/podcasts/episodes/:id/retry      a failed transcription, from the stage it failed in
 *   POST   /api/podcasts/episodes/:id/lesson     { from? } → 202: a mini lesson in MY account from that stretch
 *   DELETE /api/podcasts/episodes/:id            off "My episodes" (the shared transcript is kept)
 *
 * Public (before the auth middleware): GET /api/podcast-source/:id?exp=&sig= — the episode's
 * audio for the transcription service, by a signed, expiring link (services/podcasts/source-url.ts).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { parseByteRange, resolveServedRange } from '../services/audio';
import { trackServer } from '../services/analytics/server-events';
import { apiOrigin } from '../services/podcast-feed';
import { fetchFeed, FeedError, type PodcastFeed, type PodcastEpisodeInfo } from '../services/podcasts/rss';
import { SUGGESTED_PODCASTS } from '../services/podcasts/suggested';
import { MAX_EPISODE_MINUTES, isFakeMode, resetFailedEpisode, runPodcastEpisodeJob, transcriptionAvailable, type PodcastEpisodeMessage } from '../services/podcasts/job';
import { runPodcastLessonJob, type PodcastLessonMessage } from '../services/podcasts/lesson';
import { verifySource } from '../services/podcasts/source-url';
import {
  FEED_FRESH_MS,
  cachedFeed,
  deleteSubscription,
  episodeIdFor,
  episodeStatuses,
  getEpisode,
  getEpisodeUser,
  insertEpisode,
  linkEpisodeUser,
  listSubscriptions,
  myEpisodes,
  parseSegments,
  storeFeed,
  updateEpisode,
  updateEpisodeUser,
  upsertSubscription,
  type EpisodeRow,
  type EpisodeUserRow,
} from '../services/podcasts/store';

const routes = new Hono<{ Bindings: Env }>();

// Never a bare "Internal Server Error": the apps show `error` as it is.
routes.onError((err, c) => {
  console.error(`[podcasts] ${c.req.method} ${c.req.routePath} failed:`, err);
  return c.json({ error: 'Something went wrong on the server with that podcast request — try again in a moment' }, 500);
});

function userId(c: { get: (k: 'user') => { id: string } | undefined }): string | null {
  return c.get('user')?.id ?? null;
}

/** A job that went quiet this long (a lost queue message) is nudged again when someone looks. */
const STALE_MS = 20 * 60 * 1000;
/** Lessons being written longer than this are considered lost and may be asked for again. */
const LESSON_STALE_MS = 20 * 60 * 1000;

// ---------------- shaping

export function transcriptOf(r: Pick<EpisodeRow, 'status' | 'progress' | 'progress_done' | 'progress_total' | 'error' | 'duration_ms'> | undefined) {
  if (!r) return null;
  return { status: r.status, progress: r.progress, progress_done: r.progress_done, progress_total: r.progress_total, error: r.error, duration_ms: r.duration_ms };
}

export function episodeDetail(r: EpisodeRow, link: EpisodeUserRow | null) {
  const segments = r.status === 'translating' || r.status === 'ready' ? parseSegments(r.segments_json) : [];
  return {
    id: r.id,
    feed_url: r.feed_url,
    guid: r.guid,
    title: r.title,
    podcast_title: r.podcast_title,
    image_url: r.image_url,
    published_at: r.published_at,
    status: r.status,
    progress: r.progress,
    progress_done: r.progress_done,
    progress_total: r.progress_total,
    error: r.error,
    duration_ms: r.duration_ms,
    audio_bytes: r.audio_bytes,
    audio_mime: r.audio_mime,
    has_audio: !!r.audio_key,
    segments,
    lesson: link?.lesson_status ? { status: link.lesson_status, lesson_id: link.lesson_id, error: link.lesson_error } : null,
    finished_at: r.finished_at,
  };
}

function episodeSummary(r: EpisodeRow) {
  return { ...episodeDetail(r, null), segments: undefined, lesson: undefined };
}

async function feedView(env: Env, feed: PodcastFeed, fetchedAt: string, uid: string, stale = false) {
  const ids = await Promise.all(feed.episodes.map((e) => episodeIdFor(feed.feed_url, e.guid)));
  const statuses = await episodeStatuses(env.DB, ids);
  const sub = (await listSubscriptions(env.DB, uid)).find((s) => s.feed_url === feed.feed_url) ?? null;
  return {
    podcast: { feed_url: feed.feed_url, title: feed.title, author: feed.author, image_url: feed.image_url, description: feed.description, link: feed.link, language: feed.language },
    episodes: feed.episodes.map((e, i) => ({ id: ids[i], ...e, transcript: transcriptOf(statuses.get(ids[i])) })),
    subscription_id: sub?.id ?? null,
    fetched_at: fetchedAt,
    stale,
    transcription_available: transcriptionAvailable(env),
    max_minutes: MAX_EPISODE_MINUTES,
  };
}

/** The feed, from the shared cache while fresh; refetched otherwise (a failed refetch serves the old copy as `stale`). */
export async function loadFeed(env: Env, url: string, refresh: boolean): Promise<{ feed: PodcastFeed; fetched_at: string; stale: boolean }> {
  const cached = await cachedFeed(env.DB, url);
  if (cached && !refresh && Date.now() - Date.parse(cached.fetched_at) < FEED_FRESH_MS) return { ...cached, stale: false };
  try {
    const feed = await fetchFeed(url);
    const now = new Date();
    await storeFeed(env.DB, feed, now);
    return { feed, fetched_at: now.toISOString(), stale: false };
  } catch (err) {
    if (cached) return { ...cached, stale: true };
    throw err;
  }
}

function feedErrorResponse(c: { json: (b: unknown, s: 400 | 404 | 502) => Response }, err: unknown): Response {
  if (err instanceof FeedError) return c.json({ error: err.message }, err.status);
  console.error('[podcasts] feed failed:', err);
  return c.json({ error: "Couldn't read that podcast feed" }, 502);
}

async function startEpisodeJob(c: { env: Env; executionCtx: ExecutionContext }, episodeId: string): Promise<void> {
  if (isFakeMode(c.env)) {
    // E2E_TEST_MODE: the fake transcription runs right here (a second), no queue.
    c.executionCtx.waitUntil(
      (async () => {
        for (let i = 0; i < 10; i++) {
          const out = await runPodcastEpisodeJob(c.env, episodeId, { requeue: async () => {} });
          if (out !== 'continue' && out !== 'waiting') break;
        }
      })(),
    );
    return;
  }
  const msg: PodcastEpisodeMessage = { kind: 'podcast_episode', episodeId };
  await c.env.AUDIO_LESSON_QUEUE.send(msg as never);
}

async function nudgeIfStale(c: { env: Env; executionCtx: ExecutionContext }, row: EpisodeRow): Promise<void> {
  if (row.status === 'ready' || row.status === 'failed') return;
  if (Date.now() - Date.parse(`${row.updated_at}${row.updated_at.endsWith('Z') ? '' : 'Z'}`) < STALE_MS) return;
  await updateEpisode(c.env.DB, row.id, { progress: row.progress });
  await startEpisodeJob(c, row.id);
}

// ---------------- routes

routes.get('/podcasts', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const [subs, mine] = await Promise.all([listSubscriptions(c.env.DB, uid), myEpisodes(c.env.DB, uid)]);
  const subscribed = new Set(subs.map((s) => s.feed_url));
  return c.json({
    subscriptions: subs.map((s) => ({ id: s.id, feed_url: s.feed_url, title: s.title, author: s.author, image_url: s.image_url, description: s.description, created_at: s.created_at })),
    suggested: SUGGESTED_PODCASTS.map((s) => ({ ...s, subscribed: subscribed.has(s.feed_url) })),
    episodes: mine.map(episodeSummary),
    transcription_available: transcriptionAvailable(c.env),
  });
});

routes.post('/podcasts/subscriptions', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.json<{ url?: unknown }>().catch(() => ({} as { url?: unknown }));
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url || url.length > 2000) return c.json({ error: 'Paste the podcast\'s RSS link' }, 400);
  let loaded;
  try {
    loaded = await loadFeed(c.env, url, false);
  } catch (err) {
    return feedErrorResponse(c, err);
  }
  const sub = await upsertSubscription(c.env.DB, uid, loaded.feed);
  void trackServer('podcast.subscribe', { suggested: SUGGESTED_PODCASTS.some((s) => s.feed_url === loaded.feed.feed_url), episodes: loaded.feed.episodes.length }, { env: c.env, userId: uid });
  return c.json({ subscription: sub, feed: await feedView(c.env, loaded.feed, loaded.fetched_at, uid, loaded.stale) }, 201);
});

routes.delete('/podcasts/subscriptions/:id', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  return c.json({ deleted: await deleteSubscription(c.env.DB, uid, c.req.param('id')) });
});

routes.get('/podcasts/feed', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const url = (c.req.query('url') ?? '').trim();
  if (!url) return c.json({ error: 'url is required' }, 400);
  try {
    const loaded = await loadFeed(c.env, url, c.req.query('refresh') === '1');
    return c.json(await feedView(c.env, loaded.feed, loaded.fetched_at, uid, loaded.stale));
  } catch (err) {
    return feedErrorResponse(c, err);
  }
});

routes.post('/podcasts/episodes', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.json<{ feed_url?: unknown; guid?: unknown }>().catch(() => ({} as { feed_url?: unknown; guid?: unknown }));
  const feedUrl = typeof body.feed_url === 'string' ? body.feed_url.trim() : '';
  const guid = typeof body.guid === 'string' ? body.guid.trim() : '';
  if (!feedUrl || !guid) return c.json({ error: 'feed_url and guid are required' }, 400);
  // The episode comes from the feed as the SERVER read it (never from the client): the transcript is shared.
  let feed: PodcastFeed;
  try {
    feed = (await loadFeed(c.env, feedUrl, false)).feed;
  } catch (err) {
    return feedErrorResponse(c, err);
  }
  let ep: PodcastEpisodeInfo | undefined = feed.episodes.find((e) => e.guid === guid);
  if (!ep) {
    try {
      feed = (await loadFeed(c.env, feedUrl, true)).feed;
      ep = feed.episodes.find((e) => e.guid === guid);
    } catch {
      /* the cached copy was all there is */
    }
  }
  if (!ep) return c.json({ error: 'That episode is no longer in the feed' }, 404);
  const id = await episodeIdFor(feed.feed_url, ep.guid);
  const existing = await getEpisode(c.env.DB, id);
  if (existing) {
    // The link row references the episode row (FK), so it is written only once the episode exists.
    await linkEpisodeUser(c.env.DB, uid, id);
    if (existing.status === 'failed') {
      await resetFailedEpisode(c.env.DB, existing);
      await startEpisodeJob(c, id);
    } else {
      await nudgeIfStale(c, existing);
    }
    const row = (await getEpisode(c.env.DB, id))!;
    void trackServer('podcast.transcribe', { shared: true, status: row.status }, { env: c.env, userId: uid });
    return c.json({ episode: episodeDetail(row, await getEpisodeUser(c.env.DB, uid, id)), existing: true }, row.status === 'ready' ? 200 : 202);
  }
  if (!transcriptionAvailable(c.env)) return c.json({ error: 'Transcription is not set up on the server yet' }, 503);
  if (ep.duration_s && ep.duration_s > MAX_EPISODE_MINUTES * 60) {
    return c.json({ error: `This episode is ${Math.round(ep.duration_s / 60)} minutes long — episodes up to ${MAX_EPISODE_MINUTES} minutes can be transcribed` }, 400);
  }
  await insertEpisode(c.env.DB, id, feed, ep, uid, apiOrigin(c.env, c.req.url));
  await linkEpisodeUser(c.env.DB, uid, id);
  await startEpisodeJob(c, id);
  void trackServer('podcast.transcribe', { shared: false, status: 'queued' }, { env: c.env, userId: uid });
  return c.json({ episode: episodeDetail((await getEpisode(c.env.DB, id))!, await getEpisodeUser(c.env.DB, uid, id)), existing: false }, 202);
});

routes.get('/podcasts/episodes/:id', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const row = await getEpisode(c.env.DB, c.req.param('id'));
  if (!row) return c.json({ error: 'Not found' }, 404);
  await nudgeIfStale(c, row);
  await linkEpisodeUser(c.env.DB, uid, row.id);
  return c.json({ episode: episodeDetail(row, await getEpisodeUser(c.env.DB, uid, row.id)) });
});

routes.delete('/podcasts/episodes/:id', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const res = await c.env.DB.prepare('DELETE FROM podcast_episode_users WHERE user_id = ? AND episode_id = ?').bind(uid, c.req.param('id')).run();
  return c.json({ removed: (res.meta?.changes ?? 0) > 0 });
});

routes.post('/podcasts/episodes/:id/retry', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const row = await getEpisode(c.env.DB, c.req.param('id'));
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.status !== 'failed') {
    await nudgeIfStale(c, row);
    return c.json({ episode: episodeDetail(row, await getEpisodeUser(c.env.DB, uid, row.id)) }, row.status === 'ready' ? 200 : 202);
  }
  if (!transcriptionAvailable(c.env)) return c.json({ error: 'Transcription is not set up on the server yet' }, 503);
  await resetFailedEpisode(c.env.DB, row);
  await linkEpisodeUser(c.env.DB, uid, row.id);
  await startEpisodeJob(c, row.id);
  return c.json({ episode: episodeDetail((await getEpisode(c.env.DB, row.id))!, await getEpisodeUser(c.env.DB, uid, row.id)) }, 202);
});

routes.post('/podcasts/episodes/:id/lesson', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const row = await getEpisode(c.env.DB, c.req.param('id'));
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.status !== 'ready') return c.json({ error: 'The episode is still being transcribed — try again once it is ready' }, 409);
  if (!c.env.ANTHROPIC_API_KEY && !isFakeMode(c.env)) return c.json({ error: 'Lessons need the Claude key, which is not configured on the server' }, 503);
  const body = await c.req.json<{ from?: unknown }>().catch(() => ({} as { from?: unknown }));
  const from = typeof body.from === 'number' && Number.isInteger(body.from) && body.from >= 0 ? body.from : 0;
  await linkEpisodeUser(c.env.DB, uid, row.id);
  const link = (await getEpisodeUser(c.env.DB, uid, row.id))!;
  const startedAt = Date.parse(link.lesson_started_at ?? '');
  if (link.lesson_status === 'generating' && Number.isFinite(startedAt) && Date.now() - startedAt < LESSON_STALE_MS) {
    return c.json({ lesson: { status: 'generating', lesson_id: link.lesson_id, error: null } }, 202);
  }
  await updateEpisodeUser(c.env.DB, uid, row.id, { lesson_status: 'generating', lesson_error: null, lesson_from: from, lesson_started_at: new Date().toISOString() });
  if (isFakeMode(c.env)) {
    c.executionCtx.waitUntil(runPodcastLessonJob(c.env, row.id, uid).then(() => undefined));
  } else {
    const msg: PodcastLessonMessage = { kind: 'podcast_lesson', episodeId: row.id, userId: uid };
    await c.env.AUDIO_LESSON_QUEUE.send(msg as never);
  }
  return c.json({ lesson: { status: 'generating', lesson_id: link.lesson_id, error: null } }, 202);
});

/** An R2 object as audio, with Range (players and downloads resume with it). */
async function serveAudio(c: { req: { header: (n: string) => string | undefined; method: string }; env: Env }, key: string, mime: string, filename: string): Promise<Response> {
  const head = await c.env.AUDIO_BUCKET.head(key);
  if (!head) return new Response('Not found', { status: 404 });
  const size = head.size;
  const headers = new Headers({ 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=86400', ETag: `"${head.etag}"`, 'Content-Disposition': `inline; filename="${filename}"` });
  const rangeHeader = c.req.header('Range');
  const range = parseByteRange(rangeHeader);
  if (rangeHeader && range) {
    const start = 'suffix' in range ? Math.max(0, size - range.suffix) : range.offset ?? 0;
    if (start >= size) {
      headers.set('Content-Range', `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    const clamped = 'suffix' in range ? range : { offset: start, length: Math.min(range.length ?? size - start, size - start) };
    const object = c.req.method === 'HEAD' ? null : await c.env.AUDIO_BUCKET.get(key, { range: clamped });
    const served = (object && resolveServedRange(object.range, size)) ?? resolveServedRange(clamped, size)!;
    headers.set('Content-Length', String(served.length));
    headers.set('Content-Range', `bytes ${served.offset}-${served.offset + served.length - 1}/${size}`);
    return new Response(object?.body ?? null, { status: 206, headers });
  }
  headers.set('Content-Length', String(size));
  if (c.req.method === 'HEAD') return new Response(null, { headers });
  const object = await c.env.AUDIO_BUCKET.get(key);
  if (!object) return new Response('Not found', { status: 404 });
  return new Response(object.body, { headers });
}

routes.get('/podcasts/episodes/:id/audio', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const row = await getEpisode(c.env.DB, c.req.param('id'));
  if (!row?.audio_key) return c.json({ error: 'Not found' }, 404);
  return serveAudio(c, row.audio_key, row.audio_mime || 'audio/mpeg', row.audio_key.split('/').pop() ?? 'episode.mp3');
});

export const podcastsRoutes = routes;

/** GET /api/podcast-source/:id?exp=&sig= — for the transcription service only (signed, expiring). */
export const podcastSourcePublic = new Hono<{ Bindings: Env }>();

podcastSourcePublic.on(['GET', 'HEAD'], '/:id', async (c) => {
  const id = c.req.param('id');
  if (!c.env.SESSION_SECRET || !(await verifySource(c.env.SESSION_SECRET, id, c.req.query('exp'), c.req.query('sig')))) return new Response('Not found', { status: 404 });
  const row = await getEpisode(c.env.DB, id);
  if (!row?.audio_key) return new Response('Not found', { status: 404 });
  return serveAudio(c, row.audio_key, row.audio_mime || 'audio/mpeg', row.audio_key.split('/').pop() ?? 'episode.mp3');
});

/** The queue side (audio-lesson-queue): `{ kind: 'podcast_episode' | 'podcast_lesson', … }`. */
export async function handlePodcastQueueMessage(env: Env, body: PodcastEpisodeMessage | PodcastLessonMessage): Promise<string> {
  if (body.kind === 'podcast_lesson') return runPodcastLessonJob(env, body.episodeId, body.userId);
  return runPodcastEpisodeJob(env, body.episodeId);
}
