/**
 * 📺 Watch (追剧, docs/WATCH.md): Chinese TV on YouTube with a timed, tappable transcript. The apps
 * play the video in YouTube's own embedded player; the worker only keeps the video id, its title
 * and the transcript Gemini reads from the public video (services/watch/).
 *
 * Signed in (mounted under /api after the auth middleware):
 *   GET    /api/watch                        my videos (newest opened first) + `available`
 *   POST   /api/watch/videos                 { url | video_id, duration_ms, title?, source? } → 202 { video } (200 when ready)
 *   GET    /api/watch/videos/:id             the video with its lines so far
 *   PUT    /api/watch/videos/:id/position    { position_ms } — where I am (resume)
 *   POST   /api/watch/videos/:id/retry       a failed transcript, from where it stopped → 202
 *   DELETE /api/watch/videos/:id             off my list (the shared transcript is kept)
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { WATCH_MAX_MINUTES, parseYouTubeVideoId, youtubeWatchUrl } from '@shared/watch';
import { trackServer } from '../services/analytics/server-events';
import { getVideo, getVideoUser, insertVideo, linkVideoUser, myVideos, savePosition, touchVideoUser, unlinkVideoUser, updateVideo, videoDetail, videoSummary, type WatchVideoRow } from '../services/watch/store';
import { isWatchFakeMode, resetFailedVideo, runWatchTranscriptJob, watchTranscriptAvailable, type WatchTranscriptMessage } from '../services/watch/job';

const routes = new Hono<{ Bindings: Env }>();

routes.onError((err, c) => {
  console.error(`[watch] ${c.req.method} ${c.req.routePath} failed:`, err);
  return c.json({ error: 'Something went wrong on the server with that video — try again in a moment' }, 500);
});

function userId(c: { get: (k: 'user') => { id: string } | undefined }): string | null {
  return c.get('user')?.id ?? null;
}

/** A job that went quiet this long (a lost queue message) is nudged again when someone looks. */
const STALE_MS = 10 * 60 * 1000;
/** Longest video accepted (the player reports the duration). */
const MAX_DURATION_MS = WATCH_MAX_MINUTES * 60 * 1000;

async function startJob(c: { env: Env; executionCtx: ExecutionContext }, videoId: string): Promise<void> {
  if (isWatchFakeMode(c.env)) {
    // E2E_TEST_MODE: the stand-in transcript is made right here, no queue.
    c.executionCtx.waitUntil(
      (async () => {
        for (let i = 0; i < 40; i++) {
          const out = await runWatchTranscriptJob(c.env, videoId, { requeue: async () => {} });
          if (out !== 'continue' && out !== 'waiting') break;
        }
      })().catch((err) => console.error('[watch] fake job failed:', err)),
    );
    return;
  }
  const msg: WatchTranscriptMessage = { kind: 'video_transcript', videoId };
  await c.env.AUDIO_LESSON_QUEUE.send(msg as never);
}

async function nudgeIfStale(c: { env: Env; executionCtx: ExecutionContext }, row: WatchVideoRow): Promise<void> {
  if (row.status === 'ready' || row.status === 'failed') return;
  if (Date.now() - Date.parse(`${row.updated_at}${row.updated_at.endsWith('Z') ? '' : 'Z'}`) < STALE_MS) return;
  await updateVideo(c.env.DB, row.id, { progress: row.progress });
  await startJob(c, row.id);
}

export interface VideoMeta {
  title: string;
  channel: string | null;
}

/**
 * YouTube's public oEmbed: the title and channel, and whether the video can be embedded at all
 * (401 / 403 = private or embedding switched off, 404 = no such video). Null when YouTube didn't
 * answer (the client's title is used then).
 */
export async function youtubeMeta(videoId: string, fetchImpl: typeof fetch = fetch): Promise<VideoMeta | { refused: string } | null> {
  try {
    const res = await fetchImpl(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youtubeWatchUrl(videoId))}`, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json' },
    });
    if (res.status === 401 || res.status === 403) return { refused: "This video can't be played outside YouTube (it's private, or its owner turned embedding off)" };
    if (res.status === 404 || res.status === 400) return { refused: "That YouTube video doesn't exist (or isn't public)" };
    if (!res.ok) return null;
    const j = (await res.json()) as { title?: unknown; author_name?: unknown };
    return {
      title: typeof j.title === 'string' ? j.title.trim().slice(0, 200) : '',
      channel: typeof j.author_name === 'string' ? j.author_name.trim().slice(0, 120) : null,
    };
  } catch {
    return null;
  }
}

routes.get('/watch', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const rows = await myVideos(c.env.DB, uid);
  return c.json({
    videos: rows.map((r) => videoSummary(r, { position_ms: r.position_ms, last_opened_at: r.last_opened_at, created_at: r.added_at })),
    available: watchTranscriptAvailable(c.env),
  });
});

routes.post('/watch/videos', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const input = typeof body.video_id === 'string' ? body.video_id : typeof body.url === 'string' ? body.url : '';
  const id = parseYouTubeVideoId(input.slice(0, 2000));
  if (!id) return c.json({ error: 'Paste a YouTube video link (youtube.com/watch?v=… or youtu.be/…)' }, 400);
  const source = body.source === 'share' || body.source === 'show' ? body.source : 'paste';
  const duration = typeof body.duration_ms === 'number' && Number.isFinite(body.duration_ms) ? Math.round(body.duration_ms) : null;
  const clientTitle = typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim().slice(0, 200) : '';

  const existing = await getVideo(c.env.DB, id);
  if (existing) {
    await linkVideoUser(c.env.DB, uid, id);
    if (!existing.duration_ms && duration && duration > 0 && duration <= MAX_DURATION_MS) await updateVideo(c.env.DB, id, { duration_ms: duration });
    if (existing.status === 'failed') {
      if (!watchTranscriptAvailable(c.env)) return c.json({ error: 'Transcripts are not set up on the server yet' }, 503);
      await resetFailedVideo(c.env.DB, (await getVideo(c.env.DB, id))!);
      await startJob(c, id);
    } else {
      await nudgeIfStale(c, existing);
    }
    const row = (await getVideo(c.env.DB, id))!;
    void trackServer('watch.add', { shared: true, status: row.status, source }, { env: c.env, userId: uid });
    return c.json({ video: videoDetail(row, await getVideoUser(c.env.DB, uid, id)), existing: true }, row.status === 'ready' ? 200 : 202);
  }

  if (!duration || duration < 1000) return c.json({ error: "The video's length is missing — let the player load it first" }, 400);
  if (duration > MAX_DURATION_MS) {
    return c.json({ error: `This video is ${Math.round(duration / 60000)} minutes long — videos up to ${WATCH_MAX_MINUTES} minutes can be transcribed` }, 400);
  }
  if (!watchTranscriptAvailable(c.env)) return c.json({ error: 'Transcripts are not set up on the server yet' }, 503);
  const meta = isWatchFakeMode(c.env) ? null : await youtubeMeta(id);
  if (meta && 'refused' in meta) return c.json({ error: meta.refused }, 400);
  await insertVideo(c.env.DB, { id, title: meta?.title || clientTitle || 'YouTube video', channel: meta?.channel ?? null, duration_ms: duration, userId: uid });
  await linkVideoUser(c.env.DB, uid, id);
  await startJob(c, id);
  void trackServer('watch.add', { shared: false, status: 'queued', source }, { env: c.env, userId: uid });
  return c.json({ video: videoDetail((await getVideo(c.env.DB, id))!, await getVideoUser(c.env.DB, uid, id)), existing: false }, 202);
});

routes.get('/watch/videos/:id', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const row = await getVideo(c.env.DB, c.req.param('id'));
  if (!row) return c.json({ error: 'Not found' }, 404);
  await nudgeIfStale(c, row);
  await touchVideoUser(c.env.DB, uid, row.id);
  return c.json({ video: videoDetail(row, await getVideoUser(c.env.DB, uid, row.id)) });
});

routes.put('/watch/videos/:id/position', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.json<{ position_ms?: unknown }>().catch(() => ({} as { position_ms?: unknown }));
  const pos = typeof body.position_ms === 'number' && Number.isFinite(body.position_ms) && body.position_ms >= 0 ? body.position_ms : null;
  if (pos === null || pos > MAX_DURATION_MS * 2) return c.json({ error: 'position_ms must be a number of milliseconds' }, 400);
  return c.json({ saved: await savePosition(c.env.DB, uid, c.req.param('id'), pos) });
});

routes.post('/watch/videos/:id/retry', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const row = await getVideo(c.env.DB, c.req.param('id'));
  if (!row) return c.json({ error: 'Not found' }, 404);
  await linkVideoUser(c.env.DB, uid, row.id);
  if (row.status !== 'failed') {
    await nudgeIfStale(c, row);
    return c.json({ video: videoDetail(row, await getVideoUser(c.env.DB, uid, row.id)) }, row.status === 'ready' ? 200 : 202);
  }
  if (!watchTranscriptAvailable(c.env)) return c.json({ error: 'Transcripts are not set up on the server yet' }, 503);
  await resetFailedVideo(c.env.DB, row);
  await startJob(c, row.id);
  void trackServer('watch.retry', {}, { env: c.env, userId: uid });
  return c.json({ video: videoDetail((await getVideo(c.env.DB, row.id))!, await getVideoUser(c.env.DB, uid, row.id)) }, 202);
});

routes.delete('/watch/videos/:id', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  return c.json({ removed: await unlinkVideoUser(c.env.DB, uid, c.req.param('id')) });
});

export const watchRoutes = routes;

/** The queue side (audio-lesson-queue): `{ kind: 'video_transcript', videoId }`. */
export async function handleWatchQueueMessage(env: Env, body: WatchTranscriptMessage): Promise<string> {
  return runWatchTranscriptJob(env, body.videoId);
}
