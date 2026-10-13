/**
 * Prepared in-call activities (services/prepared-activities/) against real
 * SQLite with every migration: a lesson report queues ONE job (idempotent per
 * lesson + calls), the job briefs the model with the student's material,
 * refused activities go to a repair round, what passes is stored, a redelivery
 * adds nothing, a rewritten report replaces that lesson's ready ones, the call
 * room's take marks one used (only in its own relationship), the nightly
 * catch-up, and the E2E fake's output is fully valid.
 */
import { describe, it, expect, vi } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import {
  buildCoverage,
  buildBriefing,
  getJob,
  listPrepared,
  loadActivityContext,
  loadCoverage,
  prepareAfterLesson,
  prepareNightly,
  relationshipPeople,
  runPrepareJob,
  takePreparedForCall,
  fixActivityPinyin,
} from '../prepared-activities';
import { fakePrepareClient } from '../prepared-activities/fake';
import { parseGeneratedActivity, startActivity, validateActivitySpec, type ActivitySpec } from '@shared/call-activities';
import type { CallReport } from '../calls/report';

const REPORT: CallReport = {
  summary: 'Talked about being ill: symptoms, seeing a doctor.',
  topics: ['Health & body vocabulary', '把 sentences'],
  vocabulary: [
    { hanzi: '头疼', pinyin: 'tóuténg', english: 'headache' },
    { hanzi: '发烧', pinyin: 'fāshāo', english: 'to have a fever' },
    { hanzi: '咳嗽', pinyin: 'késou', english: 'to cough' },
    { hanzi: '感冒', pinyin: 'gǎnmào', english: 'a cold' },
  ],
  corrections: [
    { said: '我很头疼', better: '我头很疼', explanation: 'The body part is the subject' },
    { said: '我有发烧', better: '我发烧了', explanation: '发烧 is a verb' },
    { said: '我吃药了把', better: '我把药吃了', explanation: '把 + object before the verb' },
  ],
  follow_ups: ['More 把'],
  model: 'm',
  generated_at: '2026-10-05T12:00:00Z',
};

const T = Date.parse('2026-10-05T10:00:00Z');

async function seed(): Promise<SqliteD1> {
  const db = await createSqliteD1();
  db.raw.exec(`INSERT INTO users (id, email, name) VALUES ('tutor', 't@x', 'Minghui'), ('jerome', 'j@x', 'Jerome Swannack'), ('other', 'o@x', 'Other')`);
  db.raw.exec(
    `INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel', 'tutor', 'jerome', 'tutor', 'active'), ('rel2', 'tutor', 'other', 'tutor', 'active')`,
  );
  db.raw.exec(`INSERT INTO student_profiles (relationship_id, tutor_id, student_id, body, level) VALUES ('rel', 'tutor', 'jerome', 'Loves football; keep it practical.', 'elementary')`);
  db.raw.exec(
    `INSERT INTO call_lessons (id, relationship_id, created_by, started_at, last_ended_at, processing_status, summary_json, report_call_ids)
     VALUES ('L1', 'rel', 'tutor', ${T}, ${T + 3_600_000}, 'done', '${JSON.stringify(REPORT).replace(/'/g, "''")}', '["c1"]')`,
  );
  db.raw.exec(
    `INSERT INTO tutor_lesson_log (id, relationship_id, tutor_id, student_id, lesson_at, notes, title) VALUES ('log1', 'rel', 'tutor', 'jerome', '2026-10-01T10:00:00Z', '比 sentences and measure words', 'Comparisons')`,
  );
  return db;
}

function envFor(db: SqliteD1, sent: unknown[] = []) {
  return { DB: db, ANTHROPIC_API_KEY: 'test', CALL_QUEUE: { send: vi.fn(async (m: unknown) => void sent.push(m)) } } as never;
}

/** A model that writes what `replies` say, one reply per call; records the prompts it got. */
function scriptedClient(replies: unknown[][]) {
  const prompts: string[] = [];
  let i = 0;
  const client = {
    messages: {
      create: vi.fn(async (params: { messages: Array<{ content: unknown }> }) => {
        prompts.push(String(params.messages[0]?.content ?? ''));
        const activities = replies[Math.min(i++, replies.length - 1)];
        return { stop_reason: 'tool_use', usage: { input_tokens: 5000, output_tokens: 3000 }, content: [{ type: 'tool_use', id: 't', name: 'prepare_activities', input: { activities } }] };
      }),
    },
  };
  return { client: client as never, prompts, calls: () => i };
}

const DICTATION = {
  kind: 'dictation',
  title: "Dictation: last lesson's words",
  title_zh: '听写',
  why: 'New words from 5 Oct: 头疼, 发烧…',
  summary: 'The tutor says a word; the student types it.',
  items: [
    { hanzi: '头疼', pinyin: 'tóuténg', english: 'headache' },
    { hanzi: '发烧', pinyin: 'fāshāo', english: 'fever' },
    { hanzi: '一个病人', pinyin: 'yī gè bìngrén', english: 'a patient' },
  ],
};
const BAD_QUIZ = { kind: 'quiz', title: 'Which is right?', why: 'Last lesson: 3 corrections', summary: 'Pick the right one.', questions: [{ prompt: 'Which?', options: ['我头很疼', '我很头疼'], answer: 0 }] };
const GOOD_QUIZ = {
  ...BAD_QUIZ,
  questions: [
    { prompt: 'Which?', options: ['我头很疼', '我很头疼'], answer: 0 },
    { prompt: 'Which?', options: ['我有发烧', '我发烧了'], answer: 1 },
    { prompt: 'Which?', options: ['我把药吃了', '我吃药了把'], answer: 0 },
  ],
};

describe('prepared activities', { timeout: 30_000 }, () => {
  it('coverage merges call lessons and logged lessons by day, newest first, words once', () => {
    const c = buildCoverage({
      callLessons: [
        { id: 'a', started_at: Date.parse('2026-10-05T10:00:00Z'), report: REPORT },
        { id: 'b', started_at: Date.parse('2026-10-05T15:00:00Z'), report: { ...REPORT, topics: ['Doctor role-play'], vocabulary: [{ hanzi: '医生', pinyin: 'yīshēng', english: 'doctor' }, REPORT.vocabulary[0]] } },
      ],
      logEntries: [
        { lesson_at: '2026-10-05T10:00:00Z', title: 'Being ill', notes: null },
        { lesson_at: '2026-10-01T10:00:00Z', title: null, notes: '比 sentences\nand measure words' },
      ],
      known: { words: { known: 3, learning: 4 }, characters: { known: 5, learning: 2 } },
      homeworkWords: [{ hanzi: '药', pinyin: 'yào', english: 'medicine' }, { hanzi: '头疼', pinyin: '', english: '' }],
    });
    expect(c.lessons.map((l) => [l.date, l.source, l.title])).toEqual([
      ['2026-10-05', 'call', 'Being ill'],
      ['2026-10-01', 'notes', '比 sentences'],
    ]);
    expect(c.lessons[0].topics).toEqual(['Doctor role-play', 'Health & body vocabulary', '把 sentences']);
    expect(c.lessons[0].new_words).toBe(6);
    expect(c.lesson_count).toBe(2);
    expect(c.recent_words.map((w) => w.hanzi)).toEqual(['医生', '头疼', '发烧', '咳嗽', '感冒', '药']);
    expect(c.recent_corrections[0]).toEqual({ said: '我很头疼', better: '我头很疼' });
  });

  it('a lesson report queues one job; the job briefs the model, repairs a refused one, stores them; redelivery adds nothing', async () => {
    const db = await seed();
    const sent: unknown[] = [];
    const env = envFor(db, sent);
    await prepareAfterLesson(env, 'L1');
    await prepareAfterLesson(env, 'L1'); // the same report again: no second job
    expect(sent).toHaveLength(1);
    const jobId = (sent[0] as { jobId: string }).jobId;
    expect(sent[0]).toEqual({ kind: 'prepare_activities', jobId });

    const model = scriptedClient([[DICTATION, BAD_QUIZ], [GOOD_QUIZ]]);
    await runPrepareJob(env, jobId, { client: model.client, sleep: async () => {} });
    expect(model.calls()).toBe(2); // first reply + one repair round
    const brief = model.prompts[0];
    expect(brief).toContain('Write 5 activities.');
    expect(brief).toContain('- 头疼 (tóuténg) headache');
    expect(brief).toContain('- 我有发烧 → 我发烧了');
    expect(brief).toContain('Loves football'); // the tutor's private profile reaches the generator
    expect(brief).toContain('Jerome Swannack: '); // what they have covered
    expect(model.prompts[1]).toContain('a quiz needs at least 3 questions');

    const job = await getJob(db, jobId);
    expect(job).toMatchObject({ status: 'done', created_count: 2, trigger: 'lesson', source_lesson_id: 'L1', input_tokens: 10000, output_tokens: 6000 });
    expect(job!.cost_usd).toBeGreaterThan(0);
    const list = await listPrepared(db, 'rel');
    expect(list.map((a) => [a.spec.kind, a.status, a.source_label, a.why])).toEqual([
      ['dictation', 'ready', 'Lesson 5 Oct', 'New words from 5 Oct: 头疼, 发烧…'],
      ['quiz', 'ready', 'Lesson 5 Oct', 'Last lesson: 3 corrections'],
    ]);
    for (const a of list) expect(validateActivitySpec(a.spec)).toEqual([]);
    // 一 / 不 tone change applied to the model's pinyin.
    const dict = list[0].spec;
    if (dict.kind !== 'dictation') throw new Error('kind');
    expect(dict.items[2].pinyin).toBe('yí gè bìngrén');

    await runPrepareJob(env, jobId, { client: model.client }); // redelivered: done already
    expect(model.calls()).toBe(2);
    expect(await listPrepared(db, 'rel')).toHaveLength(2);
    // Other students' lists are their own.
    expect(await listPrepared(db, 'rel2')).toEqual([]);
  });

  it('a rewritten report (another call joined) prepares again and replaces that lesson’s ready ones; used ones stay', async () => {
    const db = await seed();
    const sent: unknown[] = [];
    const env = envFor(db, sent);
    await prepareAfterLesson(env, 'L1');
    await runPrepareJob(env, (sent[0] as { jobId: string }).jobId, { client: scriptedClient([[DICTATION, GOOD_QUIZ]]).client });
    const first = await listPrepared(db, 'rel');
    const spec = await takePreparedForCall(db, first[0].id, 'rel', 'call-9', `prepared:${first[0].id}`);
    expect(spec!.id).toBe(`prepared:${first[0].id}`);
    db.raw.exec(`UPDATE call_lessons SET report_call_ids = '["c1","c2"]' WHERE id = 'L1'`);
    await prepareAfterLesson(env, 'L1');
    expect(sent).toHaveLength(2);
    await runPrepareJob(env, (sent[1] as { jobId: string }).jobId, { client: scriptedClient([[GOOD_QUIZ]]).client });
    const after = await listPrepared(db, 'rel');
    expect(after.filter((a) => a.status === 'ready').map((a) => a.job_id)).toEqual([(sent[1] as { jobId: string }).jobId]);
    expect(after.find((a) => a.status === 'used')?.id).toBe(first[0].id);
  });

  it('the call room takes one only in its own relationship and marks it used once', async () => {
    const db = await seed();
    const sent: unknown[] = [];
    const env = envFor(db, sent);
    await prepareAfterLesson(env, 'L1');
    await runPrepareJob(env, (sent[0] as { jobId: string }).jobId, { client: scriptedClient([[DICTATION]]).client });
    const [a] = await listPrepared(db, 'rel');
    expect(await takePreparedForCall(db, a.id, 'rel2', 'call-x', `prepared:${a.id}`)).toBeNull();
    const spec = (await takePreparedForCall(db, a.id, 'rel', 'call-1', `prepared:${a.id}`)) as ActivitySpec;
    expect(startActivity(spec, { sessionId: 's', starter: 'tutor', tutor: 'tutor', present: ['tutor', 'jerome'], names: {}, now: 1 }).spec.id).toBe(`prepared:${a.id}`);
    await takePreparedForCall(db, a.id, 'rel', 'call-2', `prepared:${a.id}`); // started again later: still the first call
    const [used] = await listPrepared(db, 'rel');
    expect(used).toMatchObject({ status: 'used', used_in_call_id: 'call-1' });
    db.raw.exec(`UPDATE prepared_activities SET status = 'dismissed' WHERE id = '${a.id}'`);
    expect(await takePreparedForCall(db, a.id, 'rel', 'call-3', `prepared:${a.id}`)).toBeNull();
  });

  it('a test call with nothing to practise, a solo call or no key queues nothing; a failure is written to the job', async () => {
    const db = await seed();
    db.raw.exec(`INSERT INTO call_lessons (id, relationship_id, created_by, started_at, processing_status, summary_json) VALUES ('L0', 'rel', 'tutor', ${T - 86_400_000}, 'done', '{"summary":"testing","topics":["Video call troubleshooting"],"vocabulary":[{"hanzi":"摄像头"}],"corrections":[]}')`);
    db.raw.exec(`INSERT INTO call_lessons (id, relationship_id, created_by, started_at, processing_status, summary_json) VALUES ('S1', NULL, 'tutor', ${T}, 'done', '${JSON.stringify(REPORT).replace(/'/g, "''")}')`);
    const sent: unknown[] = [];
    await prepareAfterLesson(envFor(db, sent), 'L0');
    await prepareAfterLesson(envFor(db, sent), 'S1');
    await prepareAfterLesson({ DB: db, CALL_QUEUE: { send: async (m: unknown) => void sent.push(m) } } as never, 'L1');
    expect(sent).toEqual([]);
    await prepareAfterLesson(envFor(db, sent), 'L1');
    const jobId = (sent[0] as { jobId: string }).jobId;
    await runPrepareJob(envFor(db), jobId, { client: scriptedClient([[{ kind: 'quiz', title: 'x' }]]).client, sleep: async () => {} });
    expect(await getJob(db, jobId)).toMatchObject({ status: 'failed', error: 'Claude wrote no activity that passed the checks' });
  });

  it('nightly: a student whose newest lesson notes are newer than their newest run gets one job a night', async () => {
    const db = await seed();
    const sent: unknown[] = [];
    const now = new Date('2026-10-06T03:17:00Z');
    db.raw.exec(`UPDATE tutor_lesson_log SET created_at = '2026-10-05 20:00:00'`);
    expect(await prepareNightly(envFor(db, sent), now)).toBe(1);
    expect(await prepareNightly(envFor(db, sent), now)).toBe(0); // same night
    await runPrepareJob(envFor(db), (sent[0] as { jobId: string }).jobId, { client: scriptedClient([[DICTATION, GOOD_QUIZ, DICTATION, GOOD_QUIZ]]).client });
    db.raw.exec(`UPDATE prepared_activity_jobs SET created_at = '2026-10-06 03:17:00'`);
    expect(await prepareNightly(envFor(db, sent), new Date('2026-10-07T03:17:00Z'))).toBe(0); // nothing newer
  });

  it('the coverage and context loaders read the seeded material', async () => {
    const db = await seed();
    const people = (await relationshipPeople(db, 'rel'))!;
    expect(people).toMatchObject({ tutorId: 'tutor', studentId: 'jerome', studentName: 'Jerome Swannack' });
    expect(await relationshipPeople(db, 'nope')).toBeNull();
    const coverage = await loadCoverage(db, people);
    expect(coverage.lessons.map((l) => l.date)).toEqual(['2026-10-05', '2026-10-01']);
    expect(coverage.lesson_count).toBe(2);
    const ctx = await loadActivityContext(db, people);
    expect(ctx.lastLesson?.id).toBe('L1');
    expect(ctx.profile?.level).toBe('elementary');
    expect(buildBriefing(ctx, 4)).toContain('# Last lesson (2026-10-05)');
  });

  it('the E2E fake writes activities that all pass the checks', async () => {
    const db = await seed();
    const ctx = await loadActivityContext(db, (await relationshipPeople(db, 'rel'))!);
    const fake = fakePrepareClient();
    const reply = (await fake.messages.create({ messages: [{ content: buildBriefing(ctx, 6) }] } as never)) as unknown as { content: { input: { activities: unknown[] } }[] };
    const acts = reply.content[0].input.activities;
    expect(acts).toHaveLength(6);
    for (const [i, raw] of acts.entries()) {
      const parsed = parseGeneratedActivity(raw, `f-${i}`);
      expect(parsed.problems, JSON.stringify(raw).slice(0, 80)).toEqual([]);
      expect(validateActivitySpec(fixActivityPinyin(parsed.spec!))).toEqual([]);
    }
  });
});
