/**
 * Unlockable mini lessons + the companion mini lesson of an audio lesson, on real SQLite with a
 * mocked model: the companion is written (validated, a repair round, the 一 / 不 tone changes
 * applied), created LOCKED to its podcast, unlocked by a listen (once, idempotent) or by hand,
 * regenerated in place while nobody started it, kept once started; the routes on top.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type Anthropic from '@anthropic-ai/sdk';
import { SAMPLE_DIALOGUE_PLAN } from '@shared/audio-lesson';
import { validateLessonSpec, type CustomLessonSpec } from '@shared/lesson';
import type { Env } from '../../types';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import audioLessonRoutes from '../../routes/audio-lessons';
import {
  applyYiBuToSpec,
  companionBrief,
  companionSpecProblems,
  fakeCompanionSpec,
  runCompanionJob,
  requestCompanionLesson,
  type CompanionSourceRow,
} from '../companion-lesson';
import { applyLessonUnlocks, audioLessonUnlockInfo, recordAudioListened, validateUnlockForUser } from '../lesson-unlock';
import { createCustomLessonFromSpec } from '../custom-lesson';

let db: SqliteD1;
let env: Env;

const TITLE = "去朋友家吃饭 · Dinner at a friend's parents' home";

beforeEach(async () => {
  db = await createSqliteD1();
  env = { DB: db, ANTHROPIC_API_KEY: 'k', IMAGE_QUEUE: { send: async () => {} } } as unknown as Env;
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('u1', 'learner@example.com', 'Learner', 'student'), ('u2', 'other@example.com', 'Other', 'student')");
});

function readyAudioLesson(id = 'al1', userId = 'u1', status = 'ready'): string {
  db.raw.run(
    `INSERT INTO audio_lessons (id, user_id, title, format, status, input_json, rounds, plan_json, words_json, created_at, updated_at)
     VALUES (?, ?, ?, 'dialogue', ?, '{}', 1, ?, ?, '2026-10-08T10:00:00.000Z', '2026-10-08T10:00:00.000Z')`,
    [id, userId, TITLE, status, JSON.stringify(SAMPLE_DIALOGUE_PLAN), JSON.stringify(SAMPLE_DIALOGUE_PLAN.points.map(p => ({ hanzi: p.hanzi, pinyin: p.pinyin, english: p.english, status: p.status })))],
  );
  return id;
}

function source(id = 'al1'): CompanionSourceRow {
  return db.rows<CompanionSourceRow>('SELECT * FROM audio_lessons WHERE id = ?', [id])[0];
}

/** A full companion spec the "model" returns (with 一 written without its tone change). */
function goodSpec(): CustomLessonSpec {
  const fake = fakeCompanionSpec(source());
  const extra: CustomLessonSpec['sections'][number]['exercises'] = [
    { type: 'note', title: '一下', body: '一 yī — 1st tone — one\n下 xià — 4th tone — down', sentences: [{ hanzi: '你等一下。', pinyin: 'nǐ děng yī xià.', english: 'Wait a moment.' }] },
    { type: 'scramble', english: 'Wait a moment.', tiles: ['等', '你', '一下'], correct_order: ['你', '等', '一下'] },
    { type: 'translate', english: 'Is it not?', reference_hanzi: '不是吗？', reference_pinyin: 'bù shì ma?' },
    { type: 'choice', question: 'What does 一下 mean here?', options: [{ hanzi: 'a moment' }, { hanzi: 'once more' }], correct: 0 },
    { type: 'speak', prompt: 'Say you are full.' },
  ];
  return { ...fake, sections: [{ title: 'Extra', exercises: [...extra, ...extra.slice(1, 4), ...extra.slice(1, 4)] }, ...fake.sections] };
}

function mockModel(specs: unknown[]) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const create = vi.fn(async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    calls.push(JSON.parse(JSON.stringify(params)));
    const input = specs[Math.min(calls.length - 1, specs.length - 1)];
    return { id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'tool_use', id: `t${calls.length}`, name: 'create_lesson_spec', input }] } as unknown as Anthropic.Message;
  });
  return { create, calls };
}

async function askCompanion(body: Record<string, unknown> = {}) {
  const sent: unknown[] = [];
  const res = await requestCompanionLesson(env, 'u1', 'al1', body, async (m) => { sent.push(m); });
  return { res, sent };
}

describe('the companion brief + spec helpers', () => {
  it('the brief carries the dialogue lines, speakers and points with their characters', () => {
    readyAudioLesson();
    const brief = companionBrief(source());
    expect(brief).toContain(TITLE);
    expect(brief).toContain(SAMPLE_DIALOGUE_PLAN.dialogue[0].hanzi);
    expect(brief).toContain(SAMPLE_DIALOGUE_PLAN.speakers[0].name);
    expect(brief).toContain(SAMPLE_DIALOGUE_PLAN.points[0].hanzi);
  });
  it('the 一 / 不 tone changes are applied to every pinyin', () => {
    const spec = applyYiBuToSpec({ a: { hanzi: '一个', pinyin: 'yī gè' }, b: [{ reference_hanzi: '不是', reference_pinyin: 'bù shì' }] });
    expect(spec.a.pinyin).toBe('yí gè');
    expect(spec.b[0].reference_pinyin).toBe('bú shì');
  });
  it('shape problems: too short, no conversation', () => {
    const spec: CustomLessonSpec = { title: 't', sections: [{ exercises: [{ type: 'note', body: 'x' }] }] };
    const problems = companionSpecProblems(spec, 'dialogue');
    expect(problems.some(p => p.includes('14–22'))).toBe(true);
    expect(problems.some(p => p.includes('conversation'))).toBe(true);
  });
  it('the E2E fake is a valid lesson', () => {
    readyAudioLesson();
    expect(validateLessonSpec(fakeCompanionSpec(source()))).toEqual([]);
  });
});

describe('making the companion', () => {
  it('asks → queued → written with a repair round → created LOCKED to its podcast, titled after it', async () => {
    readyAudioLesson();
    const { res, sent } = await askCompanion();
    expect(res.status).toBe(202);
    expect(sent).toEqual([{ lessonId: 'al1', companion: true }]);
    expect(source().companion_status).toBe('generating');

    const { create, calls } = mockModel([{ title: 'x', sections: [] }, goodSpec()]);
    expect(await runCompanionJob(env, 'al1', { create })).toBe('created');
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1].messages)).toContain('Not right yet');
    expect(calls[0].thinking).toEqual({ type: 'disabled' });

    const [lesson] = db.rows<Record<string, string | null>>('SELECT * FROM custom_lessons');
    expect(lesson.title).toBe(`${TITLE} — mini lesson`);
    expect(lesson.unlock_kind).toBe('audio_lesson');
    expect(lesson.unlock_ref).toBe('al1');
    expect(lesson.unlocked_at).toBeNull();
    expect(lesson.companion_of).toBe('al1');
    expect(lesson.source).toBe('companion');
    const spec = JSON.parse(lesson.spec!) as CustomLessonSpec;
    expect(JSON.stringify(spec)).toContain('nǐ děng yí xià.');
    expect(JSON.stringify(spec)).toContain('bú shì ma?');
    expect(source().companion_status).toBeNull();
    const info = (await audioLessonUnlockInfo(db, 'u1')).get('al1');
    expect(info?.companion).toMatchObject({ status: 'locked', lesson_id: lesson.id, started: false });
  });

  it('a manual unlock carries its prompt (default: listen to the podcast)', async () => {
    readyAudioLesson();
    await askCompanion({ unlock: 'manual', prompt: 'Go to a restaurant and order 打包' });
    const { create } = mockModel([goodSpec()]);
    await runCompanionJob(env, 'al1', { create });
    const [lesson] = db.rows<Record<string, string | null>>('SELECT unlock_kind, unlock_ref, unlock_prompt FROM custom_lessons');
    expect(lesson).toEqual({ unlock_kind: 'manual', unlock_ref: null, unlock_prompt: 'Go to a restaurant and order 打包' });
  });

  it('idempotent per podcast: a second ask replaces the content in place while not started; once started it is kept', async () => {
    readyAudioLesson();
    await askCompanion();
    await runCompanionJob(env, 'al1', { create: mockModel([goodSpec()]).create });
    const firstId = db.rows<{ id: string }>('SELECT id FROM custom_lessons')[0].id;

    await askCompanion();
    const changed = goodSpec();
    changed.description = 'second version';
    expect(await runCompanionJob(env, 'al1', { create: mockModel([changed]).create })).toBe('replaced');
    const rows = db.rows<{ id: string; description: string }>('SELECT id, description FROM custom_lessons');
    expect(rows).toEqual([{ id: firstId, description: 'second version' }]);

    db.raw.run("INSERT INTO custom_lesson_completions (id, user_id, lesson_id, correct, total, completed_at, rating) VALUES ('c1', 'u1', ?, 5, 6, '2026-10-09T08:00:00.000Z', 2)", [firstId]);
    const { res, sent } = await askCompanion();
    expect(res).toMatchObject({ status: 200, started: true, existing: true });
    expect(sent).toEqual([]);
  });

  it('refuses another user, a lesson still being made, a bad unlock; fails readably', async () => {
    readyAudioLesson();
    readyAudioLesson('al2', 'u1', 'speaking');
    expect((await requestCompanionLesson(env, 'u2', 'al1', {}, async () => {})).status).toBe(404);
    expect((await requestCompanionLesson(env, 'u1', 'al2', {}, async () => {})).status).toBe(409);
    expect((await requestCompanionLesson(env, 'u1', 'al1', { unlock: 'soon' }, async () => {})).status).toBe(400);
    await askCompanion();
    const create = vi.fn(async () => { throw new Error('boom'); });
    expect(await runCompanionJob(env, 'al1', { create })).toBe('failed');
    expect(source().companion_status).toBe('failed');
    expect((await audioLessonUnlockInfo(db, 'u1', ['al1'])).get('al1')?.companion).toMatchObject({ status: 'failed', error: 'boom' });
  });
});

describe('unlocking', () => {
  async function lockedLesson(): Promise<string> {
    readyAudioLesson();
    const res = await createCustomLessonFromSpec(env, 'u1', fakeCompanionSpec(source()), 'api', { unlock: { kind: 'audio_lesson', audio_lesson_id: 'al1' }, companionOf: 'al1' });
    if (!res.ok) throw new Error(res.errors.join());
    return res.lesson.id;
  }

  it('a listen unlocks the lessons waiting on that podcast (auto), records listened_at, earliest wins', async () => {
    const id = await lockedLesson();
    const r = await recordAudioListened(db, 'u1', [{ audio_lesson_id: 'al1', listened_at: '2026-10-09T09:00:00.000Z' }]);
    expect(r).toEqual({ listened: ['al1'], not_found: [], unlocked_lessons: [id] });
    expect(db.rows('SELECT unlocked_at, unlocked_via FROM custom_lessons')).toEqual([{ unlocked_at: '2026-10-09T09:00:00.000Z', unlocked_via: 'auto' }]);
    // Again (another device, later): nothing new is unlocked and listened_at keeps the first time.
    const again = await recordAudioListened(db, 'u1', [{ audio_lesson_id: 'al1', listened_at: '2026-10-09T10:00:00.000Z' }]);
    expect(again.unlocked_lessons).toEqual([]);
    expect(source().listened_at).toBe('2026-10-09T09:00:00.000Z');
    // Someone else's podcast is not found.
    expect((await recordAudioListened(db, 'u2', [{ audio_lesson_id: 'al1' }])).not_found).toEqual(['al1']);
  });

  it('unlock events are idempotent and the earliest time wins', async () => {
    const id = await lockedLesson();
    expect(await applyLessonUnlocks(db, 'u1', [{ lesson_id: id, unlocked_at: '2026-10-09T10:00:00.000Z', via: 'manual' }]))
      .toEqual({ unlocked: [id], already: [], not_found: [], invalid: 0 });
    expect((await applyLessonUnlocks(db, 'u1', [{ lesson_id: id, unlocked_at: '2026-10-09T10:00:00.000Z', via: 'manual' }])).already).toEqual([id]);
    expect((await applyLessonUnlocks(db, 'u1', [{ lesson_id: id, unlocked_at: '2026-10-09T08:00:00.000Z', via: 'player' }])).unlocked).toEqual([id]);
    expect(db.rows('SELECT unlocked_at, unlocked_via FROM custom_lessons')).toEqual([{ unlocked_at: '2026-10-09T08:00:00.000Z', unlocked_via: 'player' }]);
    // Not the caller's / no condition / garbage.
    expect((await applyLessonUnlocks(db, 'u2', [{ lesson_id: id }])).not_found).toEqual([id]);
    const plain = await createCustomLessonFromSpec(env, 'u1', fakeCompanionSpec(source()), 'api');
    expect((await applyLessonUnlocks(db, 'u1', [{ lesson_id: plain.ok ? plain.lesson.id : '' }])).not_found).toHaveLength(1);
    expect((await applyLessonUnlocks(db, 'u1', [{ lesson_id: id, unlocked_at: 'garbage' }])).invalid).toBe(1);
    expect((await audioLessonUnlockInfo(db, 'u1')).get('al1')?.companion?.status).toBe('unlocked');
  });

  it('an unlock condition must name the caller\'s own audio lesson', async () => {
    readyAudioLesson();
    expect((await validateUnlockForUser(db, 'u1', { kind: 'audio_lesson', audio_lesson_id: 'al1' })).problems).toEqual([]);
    expect((await validateUnlockForUser(db, 'u2', { kind: 'audio_lesson', audio_lesson_id: 'al1' })).problems).toHaveLength(1);
    expect((await validateUnlockForUser(db, 'u2', { kind: 'manual', prompt: 'Watch episode 3' })).unlock).toEqual({ kind: 'manual', prompt: 'Watch episode 3' });
  });
});

describe('routes', () => {
  function makeApp(user: { id: string } | null) {
    const app = new Hono<{ Bindings: Env }>();
    app.use('*', async (c, next) => {
      if (user) c.set('user', user as never);
      await next();
    });
    app.route('/api', audioLessonRoutes);
    const queue = { send: vi.fn(async () => {}) };
    const e = { ...env, AUDIO_LESSON_QUEUE: queue } as unknown as Env;
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
    const json = (path: string, method: string, body?: unknown) =>
      app.request(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, e, ctx);
    return { json, queue };
  }

  it('POST companion-lesson queues the job; the list carries companion + listened_at; listened unlocks', async () => {
    readyAudioLesson();
    const app = makeApp({ id: 'u1' });
    const res = await app.json('/api/audio-lessons/al1/companion-lesson', 'POST', { unlock: 'audio' });
    expect(res.status).toBe(202);
    expect((await res.json() as { companion: { status: string } }).companion.status).toBe('generating');
    expect(app.queue.send).toHaveBeenCalledWith({ lessonId: 'al1', companion: true });

    await runCompanionJob(env, 'al1', { create: mockModel([goodSpec()]).create });
    const list = await (await app.json('/api/audio-lessons', 'GET')).json() as { lessons: Array<{ id: string; companion: { status: string }; listened_at: string | null }> };
    expect(list.lessons[0]).toMatchObject({ id: 'al1', listened_at: null, companion: { status: 'locked' } });

    const listened = await (await app.json('/api/audio-lessons/listened', 'POST', { events: [{ audio_lesson_id: 'al1', listened_at: '2026-10-09T09:00:00.000Z' }] })).json() as { unlocked_lessons: string[] };
    expect(listened.unlocked_lessons).toHaveLength(1);
    const detail = await (await app.json('/api/audio-lessons/al1', 'GET')).json() as { lesson: { companion: { status: string }; listened_at: string } };
    expect(detail.lesson).toMatchObject({ listened_at: '2026-10-09T09:00:00.000Z', companion: { status: 'unlocked' } });

    expect((await app.json('/api/audio-lessons/listened', 'POST', { nope: 1 })).status).toBe(400);
    expect((await makeApp(null).json('/api/audio-lessons/al1/companion-lesson', 'POST', {})).status).toBe(401);
  });
});
