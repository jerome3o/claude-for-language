/**
 * 🎬 Clips: the routes over real SQLite (import with problems / pinyin fixes, the feed and its
 * order, events + state, ownership, delete), generation through clip-queue (the stand-in and the
 * writer's repair rounds with a mocked model), the audio pre-generation, and "Learn more"
 * (the clip's one mini lesson in the caller's account, a reader, a podcast, more clips).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { SAMPLE_CLIP, SAMPLE_INTERACTIVE_CLIP, SAMPLE_STORY_CLIP, validateClipSpec, type ClipRecord, type ClipSpec } from '@shared/clips';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import clipsRoutes from '../../routes/clips';
import { handleClipMessage, runClipAudioJob, type ClipQueueMessage } from '../clips/job';
import { CLIP_INPUT_SCHEMA, CLIP_WRITER_SYSTEM, clipBriefText, fakeClipSpec, writeClipSpec } from '../clips/writer';
import { clipLessonBrief, fakeClipLessonSpec, runClipLessonJob } from '../clips/lesson';
import { clipPodcastDescription, clipReaderVocabulary } from '../clips/follow-up';
import type { Env } from '../../types';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

function makeApp(db: SqliteD1, userId: string | null, extra: Record<string, unknown> = {}) {
  const sent: ClipQueueMessage[] = [];
  const story: unknown[] = [];
  const audioLessons: unknown[] = [];
  const env = {
    DB: db,
    ANTHROPIC_API_KEY: 'k',
    CLIP_QUEUE: { send: vi.fn(async (m: ClipQueueMessage) => void sent.push(m)) },
    STORY_QUEUE: { send: vi.fn(async (m: unknown) => void story.push(m)) },
    AUDIO_LESSON_QUEUE: { send: vi.fn(async (m: unknown) => void audioLessons.push(m)) },
    ...extra,
  } as unknown as Env;
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    if (userId) c.set('user', { id: userId } as never);
    await next();
  });
  app.route('/api', clipsRoutes);
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
  const req = async (path: string, init?: RequestInit) => {
    const res = await app.request(path, init, env, ctx);
    while (pending.length) await pending.shift();
    return res;
  };
  const post = (path: string, body: unknown = {}) => req(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { req, post, env, sent, story, audioLessons };
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe('clips routes', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    db.raw.run("INSERT INTO users (id, email, name) VALUES ('u1', 'u1@x.test', 'U1'), ('u2', 'u2@x.test', 'U2')");
  });

  it('needs a signed-in user', async () => {
    const app = makeApp(db, null);
    expect((await app.req('/api/clips')).status).toBe(401);
    expect((await app.post('/api/clips', { spec: SAMPLE_CLIP })).status).toBe(401);
  });

  it('imports a spec: problems → 400, a valid one → ready, pinyin corrected, audio queued', async () => {
    const app = makeApp(db, 'u1');
    const bad = await app.post('/api/clips', { spec: { ...clone(SAMPLE_CLIP), scenes: [] } });
    expect(bad.status).toBe(400);
    expect((await json<{ problems: string[] }>(bad)).problems).toContain('scenes must have 4–10 scenes');
    expect((await app.post('/api/clips', {})).status).toBe(400);

    const spec = clone(SAMPLE_CLIP);
    (spec.scenes[2] as { sentence: { pinyin: string } }).sentence.pinyin = 'Wǒ gāngcái chīle fān.'; // 饭 is never fān
    const res = await app.post('/api/clips', { spec, source: 'agent' });
    expect(res.status).toBe(201);
    const { clip, pinyin_fixes } = await json<{ clip: ClipRecord; pinyin_fixes: Array<{ after: string }> }>(res);
    expect(clip).toMatchObject({ status: 'ready', source: 'agent', title: SAMPLE_CLIP.title, theme: 'neon' });
    expect(pinyin_fixes.map((f) => f.after)).toEqual(['Wǒ gāngcái chīle fàn.']);
    expect((clip.spec!.scenes[2] as { sentence: { pinyin: string } }).sentence.pinyin).toBe('Wǒ gāngcái chīle fàn.');
    expect(app.sent).toEqual([{ kind: 'audio', clipId: clip.id }]);
  });

  it('the feed: own clips only, unseen first, state from events (idempotent)', async () => {
    const app = makeApp(db, 'u1');
    const a = (await json<{ clip: ClipRecord }>(await app.post('/api/clips', { spec: SAMPLE_CLIP }))).clip;
    const b = (await json<{ clip: ClipRecord }>(await app.post('/api/clips', { spec: SAMPLE_STORY_CLIP }))).clip;
    const other = makeApp(db, 'u2');
    expect((await json<{ clips: ClipRecord[] }>(await other.req('/api/clips'))).clips).toEqual([]);
    expect((await other.req(`/api/clips/${a.id}`)).status).toBe(404);

    const events = [
      { id: 'e1', clip_id: a.id, kind: 'view', created_at: '2026-10-20T10:00:00Z' },
      { id: 'e2', clip_id: a.id, kind: 'complete', created_at: '2026-10-20T10:00:40Z' },
      { id: 'e3', clip_id: a.id, kind: 'like', created_at: '2026-10-20T10:00:41Z' },
      { id: 'e4', clip_id: a.id, kind: 'unlike', created_at: '2026-10-20T10:00:42Z' },
      { id: 'e5', clip_id: a.id, kind: 'save', created_at: '2026-10-20T10:00:43Z' },
      { id: 'e6', clip_id: a.id, kind: 'interact', value: -1, created_at: '2026-10-20T10:00:44Z' },
      { id: 'bad', clip_id: a.id, kind: 'dance' },
    ];
    const first = await json<{ accepted: number; stored: number; rejected: number }>(await app.post('/api/clips/events', { events }));
    expect(first).toEqual({ accepted: 6, stored: 6, rejected: 1 });
    expect(db.rows("SELECT value FROM clip_events WHERE kind = 'interact'")).toEqual([{ value: -1 }]);
    const again = await json<{ stored: number }>(await app.post('/api/clips/events', { events }));
    expect(again.stored).toBe(0);
    expect((await json<{ rejected: number }>(await other.post('/api/clips/events', { events: [{ id: 'x', clip_id: a.id, kind: 'like' }] }))).rejected).toBe(1);

    const feed = (await json<{ clips: ClipRecord[] }>(await app.req('/api/clips'))).clips;
    expect(feed.map((c) => c.id)).toEqual([b.id, a.id]);
    expect(feed[1].state).toEqual({ viewed: true, completed: true, liked: false, saved: true, skips: 0 });

    expect((await other.req(`/api/clips/${a.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await app.req(`/api/clips/${a.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(db.rows('SELECT id FROM clip_events')).toEqual([]);
  });

  it('generates on clip-queue: the stand-in under E2E, count, the active limit, retry', async () => {
    const app = makeApp(db, 'u1', { E2E_TEST_MODE: 'true' });
    expect((await app.post('/api/clips/generate', { count: 9 })).status).toBe(400);
    const res = await app.post('/api/clips/generate', { topic: '一会儿', count: 2 });
    expect(res.status).toBe(202);
    const feed = (await json<{ clips: ClipRecord[] }>(await app.req('/api/clips'))).clips;
    expect(feed.map((c) => c.status)).toEqual(['ready', 'ready']);
    expect(feed.map((c) => c.theme).sort()).toEqual(['neon', 'paper']);
    expect(feed.every((c) => c.source === 'generated' && c.spec?.topic === '一会儿')).toBe(true);

    // The active limit: six generating at most.
    db.raw.run("INSERT INTO clips (id, user_id, status, source, request) VALUES ('g1','u1','generating','generated','{}'),('g2','u1','generating','generated','{}'),('g3','u1','generating','generated','{}'),('g4','u1','generating','generated','{}'),('g5','u1','generating','generated','{}')");
    expect((await app.post('/api/clips/generate', { count: 2 })).status).toBe(409);

    db.raw.run(`INSERT INTO clips (id, user_id, status, source, request, error) VALUES ('f1','u1','failed','generated','{"topic":"打车","words":[],"variant":1,"of":1}','x')`);
    const retried = await app.post('/api/clips/f1/retry');
    expect(retried.status).toBe(202);
    expect((await json<{ clip: ClipRecord }>(await app.req('/api/clips/f1'))).clip.status).toBe('ready');
  });

  it('Learn more → ✨ one mini lesson per clip, in the caller\'s account', async () => {
    const app = makeApp(db, 'u1', { E2E_TEST_MODE: 'true' });
    const clip = (await json<{ clip: ClipRecord }>(await app.post('/api/clips', { spec: SAMPLE_CLIP }))).clip;
    expect((await app.post(`/api/clips/${clip.id}/learn-more`, { action: 'dance' })).status).toBe(400);
    const res = await app.post(`/api/clips/${clip.id}/learn-more`, { action: 'lesson' });
    expect(res.status).toBe(202);
    const after = (await json<{ clip: ClipRecord }>(await app.req(`/api/clips/${clip.id}`))).clip;
    expect(after.lesson).toMatchObject({ status: 'ready' });
    expect(db.rows<{ user_id: string; id: string }>('SELECT user_id, id FROM custom_lessons')).toEqual([{ user_id: 'u1', id: after.lesson!.lesson_id }]);
    const again = await app.post(`/api/clips/${clip.id}/learn-more`, { action: 'lesson' });
    expect(again.status).toBe(200);
    expect(db.rows('SELECT id FROM custom_lessons')).toHaveLength(1);
    expect((await makeApp(db, 'u2').post(`/api/clips/${clip.id}/learn-more`, { action: 'lesson' })).status).toBe(404);
  });

  it('Learn more → reader, podcast, more clips', async () => {
    const app = makeApp(db, 'u1');
    const clip = (await json<{ clip: ClipRecord }>(await app.post('/api/clips', { spec: SAMPLE_CLIP }))).clip;
    const reader = await app.post(`/api/clips/${clip.id}/learn-more`, { action: 'reader' });
    expect(reader.status).toBe(201);
    const readers = db.rows<{ user_id: string; topic: string; vocabulary_used: string }>('SELECT user_id, topic, vocabulary_used FROM graded_readers');
    expect(readers).toHaveLength(1);
    expect(readers[0].topic).toBe('刚 vs 刚才');
    expect(JSON.parse(readers[0].vocabulary_used).map((w: { hanzi: string }) => w.hanzi)).toEqual(['刚才', '刚']);
    expect(app.story).toMatchObject([{ mode: 'due_cards', topic: '刚 vs 刚才' }]);

    const podcast = await app.post(`/api/clips/${clip.id}/learn-more`, { action: 'podcast' });
    expect(podcast.status).toBe(202);
    const lessons = db.rows<{ user_id: string; format: string; input_json: string }>('SELECT user_id, format, input_json FROM audio_lessons');
    expect(lessons).toMatchObject([{ user_id: 'u1', format: 'dialogue' }]);
    expect(JSON.parse(lessons[0].input_json).description).toContain('刚才 (just now (a moment ago))');
    expect(app.audioLessons).toHaveLength(1);

    const more = await app.post(`/api/clips/${clip.id}/learn-more`, { action: 'more' });
    expect(more.status).toBe(202);
    expect(app.sent.filter((m) => m.kind === 'generate')).toHaveLength(2);
  });
});

describe('the writer and the jobs', () => {
  const ctx = { studying: [{ hanzi: '银行', pinyin: 'yínháng', english: 'bank' }], struggling: [{ hanzi: '马上', pinyin: 'mǎshàng', english: 'at once' }], decks: ['HSK 3'] };

  it('briefs the learner context and repairs an invalid clip', async () => {
    const text = clipBriefText({ topic: '刚 vs 刚才', words: ['马上'], variant: 2, of: 2 }, ctx, ['Old clip']);
    expect(text).toContain('Topic: 刚 vs 刚才');
    expect(text).toContain('马上 | mǎshàng | at once');
    expect(text).toContain('clip 2 of 2');
    expect(text).toContain('- Old clip');

    const good = clone(SAMPLE_CLIP) as ClipSpec;
    (good.words[0] as { pinyin: string }).pinyin = 'gāngcái';
    const create = vi.fn()
      .mockResolvedValueOnce({ stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'tool_use', id: 't1', name: 'submit_clip', input: { title: 'x', scenes: [] } }] })
      .mockResolvedValueOnce({ stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'tool_use', id: 't2', name: 'submit_clip', input: good }] });
    const usage = vi.fn();
    const spec = await writeClipSpec({ topic: null, words: [], variant: 1, of: 1 }, ctx, [], create, usage);
    expect(spec.title).toBe(SAMPLE_CLIP.title);
    expect(create).toHaveBeenCalledTimes(2);
    const repair = create.mock.calls[1][0].messages.at(-1).content[0];
    expect(repair).toMatchObject({ type: 'tool_result', is_error: true });
    expect(repair.content).toContain('scenes must have 4–10 scenes');
    expect(create.mock.calls[0][0]).toMatchObject({ thinking: { type: 'disabled' }, tool_choice: { type: 'tool', name: 'submit_clip' } });
    expect(usage).toHaveBeenCalledTimes(2);
  });

  it('the stand-ins pass their validators', () => {
    const fake = fakeClipSpec({ topic: 'x', words: [], variant: 3, of: 3 });
    expect(fake.style.theme).toBe('chalk');
    expect(validateClipSpec(fake)).toEqual([]);
    expect(fake.scenes.filter((x) => ['quiz', 'listen', 'order', 'reveal', 'speak'].includes(x.layout)).length).toBeGreaterThanOrEqual(2);
    expect(fakeClipLessonSpec(SAMPLE_CLIP).sections).toHaveLength(2);
    expect(clipLessonBrief(SAMPLE_STORY_CLIP)).toContain('小李: 马上到！一会儿就到！');
    expect(clipPodcastDescription(SAMPLE_CLIP)).toContain('刚 vs 刚才');
    expect(clipReaderVocabulary(SAMPLE_CLIP, [{ hanzi: '刚', pinyin: 'gāng', english: 'x' }, { hanzi: '银行', pinyin: 'yínháng', english: 'bank' }]).map((w) => w.hanzi)).toEqual(['刚才', '刚', '银行']);
  });

  it('makes every line ahead, once per text + voice, and puts a rate limit back', async () => {
    const db = await createSqliteD1();
    db.raw.run("INSERT INTO users (id, email, name) VALUES ('u1', 'u1@x.test', 'U1')");
    db.raw.run(`INSERT INTO clips (id, user_id, status, source, spec) VALUES ('c1', 'u1', 'ready', 'manual', '${JSON.stringify(SAMPLE_CLIP).replace(/'/g, "''")}')`);
    const sent: unknown[] = [];
    const env = { DB: db, CLIP_QUEUE: { send: vi.fn(async (m: unknown, o?: unknown) => void sent.push([m, o])) } } as unknown as Env;
    const ensure = vi.fn().mockResolvedValue({ status: 'made' });
    expect(await runClipAudioJob(env, { clipId: 'c1' }, { ensure })).toMatchObject({ clips: 6, made: 6, next: 'done' });
    expect(ensure.mock.calls.map((c) => c[1].text)).toContain('你刚才去哪儿了？');

    const limited = vi.fn().mockResolvedValueOnce({ status: 'cached' }).mockResolvedValueOnce({ status: 'rate_limited', retryAfterMs: 90_000 });
    expect((await runClipAudioJob(env, { clipId: 'c1' }, { ensure: limited })).next).toBe('rate_limited');
    expect(sent).toEqual([[{ kind: 'audio', clipId: 'c1', attempt: 1 }, { delaySeconds: 90 }]]);
    expect((await runClipAudioJob(env, { clipId: 'gone' }, { ensure })).next).toBe('gone');
  });

  it('a lesson job with a mocked model, and a generation through handleClipMessage', async () => {
    const db = await createSqliteD1();
    db.raw.run("INSERT INTO users (id, email, name) VALUES ('u1', 'u1@x.test', 'U1')");
    db.raw.run(`INSERT INTO clips (id, user_id, status, source, spec, lesson_status) VALUES ('c1', 'u1', 'ready', 'manual', '${JSON.stringify(SAMPLE_CLIP).replace(/'/g, "''")}', 'generating')`);
    const env = { DB: db, ANTHROPIC_API_KEY: 'k' } as unknown as Env;
    const lesson = fakeClipLessonSpec(SAMPLE_CLIP);
    const create = vi.fn().mockResolvedValue({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'create_lesson_spec', input: lesson }] });
    expect(await runClipLessonJob(env, 'c1', { create })).toBe('ready');
    expect(db.rows<{ lesson_status: string }>('SELECT lesson_status FROM clips')).toEqual([{ lesson_status: 'ready' }]);

    db.raw.run(`INSERT INTO clips (id, user_id, status, source, request) VALUES ('g1', 'u1', 'generating', 'generated', '{"topic":"刚","words":[],"variant":1,"of":1}')`);
    const write = vi.fn().mockResolvedValue({ stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 50 }, content: [{ type: 'tool_use', id: 't', name: 'submit_clip', input: clone(SAMPLE_STORY_CLIP) }] });
    expect(await handleClipMessage({ ...env, CLIP_QUEUE: { send: vi.fn() } } as unknown as Env, { kind: 'generate', clipId: 'g1' }, { create: write })).toBe('ready');
    expect(db.rows<{ status: string; theme: string; input_tokens: number }>("SELECT status, theme, input_tokens FROM clips WHERE id = 'g1'")).toEqual([{ status: 'ready', theme: 'ink', input_tokens: 100 }]);
  });
});

describe('interactive clips (v1 additions)', () => {
  it('the writer asks for interactive beats and the tool schema carries their bodies', () => {
    expect(CLIP_WRITER_SYSTEM).toContain('2–3 interactive beats');
    expect(CLIP_WRITER_SYSTEM).toContain('"layout": "order"');
    const scene = CLIP_INPUT_SCHEMA.properties.scenes.items.properties;
    for (const k of ['listen', 'order', 'reveal', 'speak'] as const) expect(scene[k]).toEqual({ type: 'object' });
    expect(scene.layout.enum).toEqual(expect.arrayContaining(['listen', 'order', 'reveal', 'speak']));
  });

  it('imports an interactive clip; its answers\' lines are made ahead; its interact events are kept', async () => {
    const db = await createSqliteD1();
    db.raw.run("INSERT INTO users (id, email, name) VALUES ('u1', 'u1@x.test', 'U1')");
    db.raw.run(`INSERT INTO clips (id, user_id, status, source, spec) VALUES ('c1', 'u1', 'ready', 'manual', '${JSON.stringify(SAMPLE_INTERACTIVE_CLIP).replace(/'/g, "''")}')`);
    const env = { DB: db, CLIP_QUEUE: { send: vi.fn() } } as unknown as Env;
    const ensure = vi.fn().mockResolvedValue({ status: 'made' });
    await runClipAudioJob(env, { clipId: 'c1' }, { ensure });
    const texts = ensure.mock.calls.map((c) => c[1].text);
    expect(texts).toEqual(expect.arrayContaining(['我顺便帮你拿快递。', '我下班顺便去银行', '你顺便关一下窗户。', '顺便问一下。']));
    expect(clipLessonBrief(SAMPLE_INTERACTIVE_CLIP)).toContain('- Word order: 我 下班 顺便 去 银行');
  });
});
