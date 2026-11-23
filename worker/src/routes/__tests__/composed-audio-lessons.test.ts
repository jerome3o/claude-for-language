/**
 * Composed audio lessons (shared/audio-lesson/composed.ts, docs/AUDIO_LESSONS.md "Composed lessons")
 * and the recap material of a video lesson (GET /api/calls/:id/recap, services/calls/recap.ts),
 * against real SQLite with every migration:
 * - a dry run (dry_run or /composed/preview) stores nothing and answers the estimate, chapters,
 *   transcript preview and problems; no Claude key is needed;
 * - a real create stores the plan + compiled script and queues the render; a bad plan is a 400;
 * - `source` must be a call the caller was in (its label then shows in the list);
 * - the job records and renders it without any model call;
 * - the recap route is for the call's members only, and reads only the caller's own notes / homework.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../../types';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import audioLessons from '../audio-lessons';
import callsRoutes from '../calls';
import * as q from '../../db/audio-lesson-queries';
import { runAudioLessonJob } from '../../services/audio-lessons/job';
import { fakeClip } from '../../services/audio-lessons/fake';
import { recapSourceLabel } from '../../services/calls/recap';
import { SAMPLE_COMPOSED_RECAP_PLAN, type AudioLessonScript } from '@shared/audio-lesson';

const TUTOR = 'tutor-1';
const STUDENT = 'student-1';
const STRANGER = 'stranger-1';
/** 21 Nov 2026, 10:00 UTC. */
const LESSON_START = Date.UTC(2026, 10, 21, 10, 0, 0);
const LESSON_END = LESSON_START + 50 * 60_000;

let db: SqliteD1;
let sent: unknown[];
let bucket: Map<string, Uint8Array>;
const exec = (sql: string, ...params: Array<string | number | null>) => db.raw.run(sql, params);

function fakeBucket(): R2Bucket {
  return {
    async put(key: string, value: Uint8Array) {
      bucket.set(key, value);
    },
    async get(key: string) {
      const v = bucket.get(key);
      return v ? { arrayBuffer: async () => v.slice().buffer, customMetadata: { provider: 'azure' }, size: v.length } : null;
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) bucket.delete(k);
    },
    async list(opts: { prefix?: string }) {
      return { objects: [...bucket.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).map((key) => ({ key })), truncated: false };
    },
  } as unknown as R2Bucket;
}

function env(): Env {
  // No ANTHROPIC_API_KEY on purpose: a composed lesson needs none.
  return { DB: db, AUDIO_BUCKET: fakeBucket(), AUDIO_LESSON_QUEUE: { send: async (m: unknown) => void sent.push(m) } } as unknown as Env;
}

function app(userId: string) {
  const a = new Hono<{ Bindings: Env }>();
  a.use('*', async (c, next) => {
    c.set('user', { id: userId } as never);
    await next();
  });
  a.route('/api', audioLessons);
  a.route('/api', callsRoutes);
  const e = env();
  const ctx = { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}), passThroughOnException: () => {} } as unknown as ExecutionContext;
  return async (method: string, path: string, body?: unknown) => {
    const res = await a.request(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, e, ctx);
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
}

const count = () => db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM audio_lessons')[0].n;

beforeEach(async () => {
  db = await createSqliteD1();
  sent = [];
  bucket = new Map();
  for (const [id, email, name] of [[TUTOR, 't@example.com', 'Laoshi'], [STUDENT, 's@example.com', 'Learner'], [STRANGER, 'z@example.com', 'Other']]) {
    exec('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', id, email, name);
  }
  exec("UPDATE users SET time_zone = 'Europe/London' WHERE id = ?", STUDENT);
  exec("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'tutor', 'active')", TUTOR, STUDENT);
  exec(
    "INSERT INTO call_lessons (id, relationship_id, created_by, started_at, last_ended_at, processing_status, summary_json, created_at) VALUES ('lesson-1', 'rel-1', ?, ?, ?, 'done', ?, '2026-11-21T10:00:00.000Z')",
    TUTOR,
    LESSON_START,
    LESSON_END,
    JSON.stringify({ summary: 'Weekend plans.', topics: ['weekend'], vocabulary: [{ hanzi: '爬山', pinyin: 'páshān', english: 'to hike' }], corrections: [], follow_ups: [], model: 'm', generated_at: 'x' }),
  );
  exec(
    "INSERT INTO calls (id, relationship_id, created_by, status, started_at, ended_at, lesson_id, chat_json, board_text, created_at) VALUES ('call-1', 'rel-1', ?, 'ended', ?, ?, 'lesson-1', ?, '周末 zhōumò weekend', '2026-11-21T10:00:00.000Z')",
    TUTOR,
    LESSON_START,
    LESSON_END,
    JSON.stringify([{ id: 'm1', user_id: TUTOR, name: 'Laoshi', text: '爬山', at: LESSON_START + 60_000 }]),
  );
  const seg = (id: string, user: string, at: number, text: string, pinyin: string, translation: string) =>
    exec("INSERT INTO call_transcript_segments (id, call_id, piece_id, user_id, start_ms, end_ms, text, pinyin, translation) VALUES (?, 'call-1', 'p', ?, ?, ?, ?, ?, ?)", id, user, at, at + 2000, text, pinyin, translation);
  seg('s2', STUDENT, LESSON_START + 65_000, '我打算去爬山。', 'wǒ dǎsuàn qù páshān.', "I'm planning to go hiking.");
  seg('s1', TUTOR, LESSON_START + 60_000, '你周末打算做什么？', 'nǐ zhōumò dǎsuàn zuò shénme?', 'What are you planning to do at the weekend?');
});

describe('composed audio lessons — POST /api/audio-lessons', () => {
  it('a dry run stores nothing and answers the preview (no Claude key needed)', async () => {
    const call = app(STUDENT);
    const res = await call('POST', '/api/audio-lessons', { format: 'composed', plan: SAMPLE_COMPOSED_RECAP_PLAN, dry_run: true });
    expect(res.status).toBe(200);
    expect(res.body.dry_run).toBe(true);
    expect(res.body.problems).toEqual([]);
    expect(res.body.estimate_minutes).toBeGreaterThan(3);
    expect(res.body.chapters[0]).toEqual({ title: 'What we talked about', at: '0:00' });
    expect(res.body.transcript_preview.some((r: { repeat?: string }) => r.repeat === '×3 +2')).toBe(true);
    expect(res.body.clips).toBeGreaterThan(10);
    expect(res.body.script).toBeUndefined();
    expect(count()).toBe(0);
    expect(sent).toEqual([]);

    // The preview route: the same, even without dry_run, and problems come back in a 200.
    const bad = await call('POST', '/api/audio-lessons/composed/preview', { plan: { title: 'x', blocks: [{ type: 'clip' }, { type: 'zh', hanzi: 'hello' }] } });
    expect(bad.status).toBe(200);
    expect(bad.body.problems[0]).toMatch(/reserved/);
    expect(bad.body.problems[1]).toMatch(/Chinese characters are required/);
    expect(count()).toBe(0);
  });

  it('impossible pinyin is corrected in the preview (the pinyin check)', async () => {
    const res = await app(STUDENT)('POST', '/api/audio-lessons/composed/preview', {
      plan: { title: 'T', blocks: [{ type: 'drill', hanzi: '扶梯', pinyin: 'fúqī', english: 'escalator' }] },
    });
    expect(res.body.problems).toEqual([]);
    expect(res.body.pinyin_fixes[0]).toMatchObject({ before: 'fúqī', after: 'fútī' });
    expect(res.body.transcript_preview[0].pinyin).toBe('fútī');
  });

  it('a create stores the plan + compiled script and queues the render; the job records it with no model', async () => {
    const call = app(STUDENT);
    const res = await call('POST', '/api/audio-lessons', { format: 'composed', plan: SAMPLE_COMPOSED_RECAP_PLAN, title: 'My recap' });
    expect(res.status).toBe(202);
    expect(res.body.lesson).toMatchObject({ format: 'composed', title: 'My recap', status: 'queued', source_label: null });
    expect(res.body.estimate_minutes).toBeGreaterThan(3);
    const id = res.body.lesson.id as string;
    expect(sent).toEqual([{ lessonId: id }]);
    const row = (await q.getAudioLesson(db, id))!;
    const script = JSON.parse(row.script_json!) as AudioLessonScript;
    expect(script.format).toBe('composed');
    expect(script.title).toBe('My recap');
    expect(JSON.parse(row.plan_json!).title).toBe('My recap');
    expect(row.progress_total).toBeGreaterThan(10);

    // The job: speaking + rendering only.
    const e = env();
    const speak = async (clip: { text: string; rate: number; lang: string }) => ({ ok: true as const, bytes: fakeClip(clip.text, clip.rate), provider: 'azure' as const, voice: 'v' });
    expect(await runAudioLessonJob(e, id, { speak: speak as never, requeue: async () => {} })).toBe('done');
    const detail = q.lessonDetail((await q.getAudioLesson(db, id))!);
    expect(detail.status).toBe('ready');
    expect(detail.usage).toMatchObject({ model: 'none', claude_usd: 0, rounds: 0 });
    expect(detail.chapters.map((c) => c.title)).toContain('打算 — to plan to');
    expect(detail.chapters.find((c) => c.title === '打算 — to plan to')?.pinyin).toBe('dǎsuàn');
    expect(detail.transcript.length).toBeGreaterThan(20);
    expect(detail.words.map((w) => w.hanzi)).toEqual(['打算', '爬山']);
  });

  it('a bad plan is a 400 with the problems, nothing stored', async () => {
    const res = await app(STUDENT)('POST', '/api/audio-lessons', { format: 'composed', plan: { title: 'T', blocks: [{ type: 'song' }] } });
    expect(res.status).toBe(400);
    expect(res.body.problems[0]).toMatch(/unknown block type "song"/);
    expect(count()).toBe(0);
    const none = await app(STUDENT)('POST', '/api/audio-lessons', { format: 'composed' });
    expect(none.status).toBe(400);
    expect(none.body.error).toMatch(/plan/);
  });

  it('source: a call the caller was in gives the label; anyone else\'s is refused', async () => {
    const ok = await app(STUDENT)('POST', '/api/audio-lessons', { format: 'composed', plan: SAMPLE_COMPOSED_RECAP_PLAN, source: { lesson_id: 'lesson-1' } });
    expect(ok.status).toBe(202);
    expect(ok.body.lesson.source_label).toBe('Recap of the 21 Nov lesson');
    const list = await app(STUDENT)('GET', '/api/audio-lessons');
    expect(list.body.lessons[0].source_label).toBe('Recap of the 21 Nov lesson');
    const row = (await q.getAudioLesson(db, ok.body.lesson.id))!;
    expect(JSON.parse(row.input_json!).source).toEqual({ call_id: 'call-1', lesson_id: 'lesson-1', label: 'Recap of the 21 Nov lesson' });

    const dry = await app(STUDENT)('POST', '/api/audio-lessons', { format: 'composed', plan: SAMPLE_COMPOSED_RECAP_PLAN, source: { call_id: 'call-1', label: 'Before Thursday' }, dry_run: true });
    expect(dry.body.source).toEqual({ call_id: 'call-1', lesson_id: 'lesson-1', label: 'Before Thursday' });

    const before = count();
    const refused = await app(STRANGER)('POST', '/api/audio-lessons', { format: 'composed', plan: SAMPLE_COMPOSED_RECAP_PLAN, source: { call_id: 'call-1' } });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('source.call_id is not one of your lessons');
    expect(count()).toBe(before);
  });

  it('the label follows the learner\'s time zone', () => {
    // 23:30 UTC on the 21st is the 22nd in Shanghai.
    expect(recapSourceLabel(Date.UTC(2026, 10, 21, 23, 30), 'Asia/Shanghai')).toBe('Recap of the 22 Nov lesson');
    expect(recapSourceLabel(Date.UTC(2026, 10, 21, 23, 30), null)).toBe('Recap of the 21 Nov lesson');
    expect(recapSourceLabel(null, null)).toBe('Recap of a video lesson');
  });
});

describe('GET /api/calls/:id/recap', () => {
  beforeEach(() => {
    // The tutor's logged notes, copied into the student's lesson notes; one from long before.
    exec("INSERT INTO lesson_notes (id, user_id, raw_text, given_at, created_at) VALUES ('n1', ?, '[From tutor Laoshi, 21 Nov] 打算, 爬山, 要是…就…', NULL, '2026-11-21 11:00:00')", STUDENT);
    exec("INSERT INTO lesson_notes (id, user_id, raw_text, given_at, created_at) VALUES ('n0', ?, 'old notes', NULL, '2026-10-01 11:00:00')", STUDENT);
    // Homework: a deck made from this lesson (its session-notes job), and an unrelated one a month later.
    exec("INSERT INTO decks (id, user_id, name) VALUES ('copy-1', ?, 'Weekend')", STUDENT);
    exec("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('nt1', 'copy-1', '打算', 'dǎsuàn', 'to plan to')");
    exec("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('nt2', 'copy-1', '爬山', 'páshān', 'to hike')");
    exec("INSERT INTO tutor_note_jobs (id, relationship_id, tutor_id, student_id, notes, status, source_call_id) VALUES ('job-1', 'rel-1', ?, ?, 'x', 'done', 'call-1')", TUTOR, STUDENT);
    exec(
      "INSERT INTO assignments (id, relationship_id, tutor_id, student_id, batch_id, kind, target_id, title, mode, item_count, created_at) VALUES ('a1', 'rel-1', ?, ?, 'job-1', 'deck', 'copy-1', 'Weekend', 'both', 2, '2026-11-29T09:00:00.000Z')",
      TUTOR,
      STUDENT,
    );
    exec(
      "INSERT INTO assignments (id, relationship_id, tutor_id, student_id, kind, target_id, title, mode, item_count, created_at) VALUES ('a2', 'rel-1', ?, ?, 'reader', 'r1', 'A story', 'one_off', 0, '2026-12-25T09:00:00.000Z')",
      TUTOR,
      STUDENT,
    );
  });

  it('the learner gets the transcript by speaker with offsets, board, chat, report, their notes and the homework from it', async () => {
    const res = await app(STUDENT)('GET', '/api/calls/call-1/recap');
    expect(res.status).toBe(200);
    const r = res.body.recap;
    expect(r).toMatchObject({ call_id: 'call-1', lesson_id: 'lesson-1', my_role: 'student', duration_minutes: 50, board_text: '周末 zhōumò weekend', transcript_lines_total: 2 });
    expect(r.transcript).toEqual([
      { at: '1:00', ms: 60_000, speaker: 'Laoshi (tutor)', me: false, text: '你周末打算做什么？', pinyin: 'nǐ zhōumò dǎsuàn zuò shénme?', english: 'What are you planning to do at the weekend?' },
      { at: '1:05', ms: 65_000, speaker: 'Learner (student)', me: true, text: '我打算去爬山。', pinyin: 'wǒ dǎsuàn qù páshān.', english: "I'm planning to go hiking." },
    ]);
    expect(r.chat).toEqual([{ from: 'Laoshi', text: '爬山', at: '1:00' }]);
    expect(r.report.summary).toBe('Weekend plans.');
    expect(r.report.vocabulary[0].hanzi).toBe('爬山');
    expect(r.lesson_notes.map((n: { text: string }) => n.text)).toEqual(['[From tutor Laoshi, 21 Nov] 打算, 爬山, 要是…就…']);
    expect(r.homework).toEqual([
      expect.objectContaining({ id: 'a1', kind: 'deck', from_this_lesson: true, word_count: 2, words: [
        { hanzi: '打算', pinyin: 'dǎsuàn', english: 'to plan to' },
        { hanzi: '爬山', pinyin: 'páshān', english: 'to hike' },
      ] }),
    ]);
    // No e-mail anywhere in it.
    expect(JSON.stringify(r)).not.toContain('@example.com');
    const capped = await app(STUDENT)('GET', '/api/calls/call-1/recap?max_segments=1');
    expect(capped.body.recap.transcript).toHaveLength(1);
    expect(capped.body.recap.transcript_lines_total).toBe(2);
  });

  it('the tutor sees the lesson but not the student\'s notes or homework', async () => {
    const res = await app(TUTOR)('GET', '/api/calls/call-1/recap');
    expect(res.status).toBe(200);
    expect(res.body.recap.my_role).toBe('tutor');
    expect(res.body.recap.homework).toEqual([]);
    expect(res.body.recap.lesson_notes).toEqual([]);
  });

  it('anyone who was not in the call gets 404', async () => {
    const res = await app(STRANGER)('GET', '/api/calls/call-1/recap');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('爬山');
    expect((await app(STUDENT)('GET', '/api/calls/nope/recap')).status).toBe(404);
  });
});
