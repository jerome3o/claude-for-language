/**
 * Audio lessons (docs/AUDIO_LESSONS.md) — services/audio-lessons/job.ts builds
 * them on audio-lesson-queue. Mounted under /api after the auth middleware;
 * every route is scoped to the caller's own lessons.
 *
 *   GET    /audio-lessons            { lessons: AudioLessonSummary[] } newest first (stuck builds marked failed)
 *   POST   /audio-lessons            { format: dialogue|sleep|story, description?, dialogue?, text?, title?, target_minutes?, for_relationship_id? } → 202 { lesson, notice?, chunks? }
 *   GET    /audio-lessons/:id        { lesson: AudioLessonDetail } (chapters, transcript, words, usage)
 *   GET    /audio-lessons/:id/audio  the MP3 (owner only; Range → 206)
 *   POST   /audio-lessons/:id/retry  a failed lesson again, from what was already made → 202
 *   DELETE /audio-lessons/:id        the lesson, its file and any clips
 *   POST   /audio-lessons/:id/companion-lesson  { unlock?: 'audio' | 'manual', prompt? } → 202 { companion }
 *          (its companion mini lesson, written on audio-lesson-queue; 200 + existing when it was already started)
 *   POST   /audio-lessons/listened   { events: [{ audio_lesson_id, listened_at }] } → { listened, unlocked_lessons }
 *
 * Every summary carries `listened_at` and `companion` (services/lesson-unlock.ts).
 */
import { Hono } from 'hono';
import { pickAudioLessonInput } from '@shared/audio-lesson/input';
import type { Env } from '../types';
import * as q from '../db/audio-lesson-queries';
import { parseByteRange, resolveServedRange } from '../services/audio';
import { deleteLessonObjects, runAudioLessonJob } from '../services/audio-lessons/job';
import { trackServer } from '../services/analytics/server-events';
import { audioLessonUnlockInfo, recordAudioListened, MAX_UNLOCK_EVENTS } from '../services/lesson-unlock';
import { requestCompanionLesson, runCompanionJob, type CompanionJobMessage } from '../services/companion-lesson';

/** Lessons being made at once per account. */
export const MAX_ACTIVE_AUDIO_LESSONS = 3;

const routes = new Hono<{ Bindings: Env }>();

function userId(c: { get: (k: 'user') => { id: string } | undefined }): string | null {
  return c.get('user')?.id ?? null;
}

function testMode(env: Env): boolean {
  return env.E2E_TEST_MODE === 'true';
}

/**
 * Start (or continue) a build. E2E_TEST_MODE runs it right here (fake model and
 * voices, a second or two) instead of relying on a local queue.
 */
async function startJob(c: { env: Env; executionCtx: ExecutionContext }, lessonId: string): Promise<void> {
  if (testMode(c.env)) {
    c.executionCtx.waitUntil(
      (async () => {
        for (let i = 0; i < 20; i++) {
          const out = await runAudioLessonJob(c.env, lessonId, { requeue: async () => {} });
          if (out !== 'continue' && out !== 'waiting') break;
        }
      })(),
    );
    return;
  }
  await c.env.AUDIO_LESSON_QUEUE.send({ lessonId });
}

routes.get('/audio-lessons', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  await q.markStaleAudioLessons(c.env.DB, uid);
  const rows = await q.listAudioLessons(c.env.DB, uid);
  const info = await audioLessonUnlockInfo(c.env.DB, uid);
  return c.json({ lessons: rows.map(r => ({ ...q.lessonSummary(r), ...(info.get(r.id) ?? { listened_at: null, companion: null }) })) });
});

routes.post('/audio-lessons', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  if (!c.env.ANTHROPIC_API_KEY && !testMode(c.env)) return c.json({ error: 'Audio lessons need the Claude key, which is not configured on the server' }, 503);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const picked = pickAudioLessonInput(body);
  if (picked.problems.length) return c.json({ error: picked.problems[0], problems: picked.problems }, 400);

  // A tutor may note who a lesson is for — a label only: nothing is sent to anyone.
  let forRel: string | null = null;
  const rel = (body as { for_relationship_id?: unknown }).for_relationship_id;
  if (typeof rel === 'string' && rel) {
    const row = await c.env.DB.prepare('SELECT id FROM tutor_relationships WHERE id = ? AND (requester_id = ? OR recipient_id = ?)').bind(rel, uid, uid).first<{ id: string }>();
    if (!row) return c.json({ error: 'for_relationship_id is not one of your connections' }, 400);
    forRel = row.id;
  }

  if ((await q.countActiveAudioLessons(c.env.DB, uid)) >= MAX_ACTIVE_AUDIO_LESSONS) {
    return c.json({ error: `${MAX_ACTIVE_AUDIO_LESSONS} lessons are already being made — wait for one to finish` }, 409);
  }
  const id = await q.createAudioLesson(c.env.DB, { userId: uid, format: picked.format, title: picked.title, input: picked.input, forRelationshipId: forRel });
  await startJob(c, id);
  await trackServer('server.content_created', { kind: 'audio_lesson', count: 1, via: 'api' }, { env: c.env, userId: uid });
  const row = await q.getAudioLesson(c.env.DB, id, uid);
  // Story: `notice` says when the text is longer than one lesson holds (the first part is made).
  return c.json({ lesson: q.lessonSummary(row!), ...(picked.notice ? { notice: picked.notice } : {}), ...(picked.chunks !== undefined ? { chunks: picked.chunks } : {}) }, 202);
});

routes.get('/audio-lessons/:id', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  await q.markStaleAudioLessons(c.env.DB, uid);
  const row = await q.getAudioLesson(c.env.DB, c.req.param('id'), uid);
  if (!row) return c.json({ error: 'Not found' }, 404);
  const info = (await audioLessonUnlockInfo(c.env.DB, uid, [row.id])).get(row.id);
  return c.json({ lesson: { ...q.lessonDetail(row), listened_at: info?.listened_at ?? null, companion: info?.companion ?? null } });
});

// A listen reached the end on some device: listened_at + the locked companion lessons unlocked.
routes.post('/audio-lessons/listened', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.json<{ events?: unknown }>().catch(() => null);
  if (!body || !Array.isArray(body.events)) return c.json({ error: 'events array is required' }, 400);
  if (body.events.length > MAX_UNLOCK_EVENTS) return c.json({ error: `At most ${MAX_UNLOCK_EVENTS} events at a time` }, 400);
  return c.json(await recordAudioListened(c.env.DB, uid, body.events as Array<Record<string, unknown>>));
});

/** Queue the companion job (E2E_TEST_MODE: run it right here, fake model). */
async function startCompanion(c: { env: Env; executionCtx: ExecutionContext }, msg: CompanionJobMessage): Promise<void> {
  if (testMode(c.env)) {
    c.executionCtx.waitUntil(runCompanionJob(c.env, msg.lessonId).then(() => undefined));
    return;
  }
  await c.env.AUDIO_LESSON_QUEUE.send(msg);
}

routes.post('/audio-lessons/:id/companion-lesson', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.json<{ unlock?: unknown; prompt?: unknown }>().catch(() => ({}));
  const id = c.req.param('id');
  const res = await requestCompanionLesson(c.env, uid, id, body, msg => startCompanion(c, msg));
  if ('error' in res) return c.json({ error: res.error }, res.status);
  const info = (await audioLessonUnlockInfo(c.env.DB, uid, [id])).get(id);
  return c.json({ companion: info?.companion ?? null, existing: res.existing, started: res.started }, res.status);
});

routes.get('/audio-lessons/:id/audio', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const row = await q.getAudioLesson(c.env.DB, c.req.param('id'), uid);
  if (!row?.audio_key || row.status !== 'ready') return c.json({ error: 'Not found' }, 404);
  const range = parseByteRange(c.req.header('Range'));
  const object = await c.env.AUDIO_BUCKET.get(row.audio_key, range ? { range } : undefined);
  if (!object) return c.json({ error: 'Not found' }, 404);
  const headers = new Headers();
  headers.set('Content-Type', 'audio/mpeg');
  headers.set('Accept-Ranges', 'bytes');
  // The key changes when the lesson is rebuilt; private: it is this learner's.
  headers.set('Cache-Control', 'private, max-age=31536000, immutable');
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  const served = range ? resolveServedRange(object.range, object.size) : null;
  if (served && served.length < object.size) {
    headers.set('Content-Length', String(served.length));
    headers.set('Content-Range', `bytes ${served.offset}-${served.offset + served.length - 1}/${object.size}`);
    return new Response(object.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { headers });
});

routes.post('/audio-lessons/:id/retry', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const row = await q.getAudioLesson(c.env.DB, c.req.param('id'), uid);
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.status !== 'failed') return c.json({ error: row.status === 'ready' ? 'This lesson is already made' : 'This lesson is still being made' }, 409);
  if (!c.env.ANTHROPIC_API_KEY && !testMode(c.env) && !row.script_json) return c.json({ error: 'Audio lessons need the Claude key, which is not configured on the server' }, 503);
  await q.resetAudioLessonForRetry(c.env.DB, row.id);
  await startJob(c, row.id);
  const fresh = await q.getAudioLesson(c.env.DB, row.id, uid);
  return c.json({ lesson: q.lessonSummary(fresh!) }, 202);
});

routes.delete('/audio-lessons/:id', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const row = await q.getAudioLesson(c.env.DB, c.req.param('id'), uid);
  if (!row) return c.json({ ok: true });
  await q.deleteAudioLessonRow(c.env.DB, row.id, uid);
  await deleteLessonObjects(c.env.AUDIO_BUCKET, uid, row.id, row.audio_key).catch((err) => console.error('[audio-lesson] delete objects', err));
  return c.json({ ok: true });
});

export default routes;
