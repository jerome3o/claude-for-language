/**
 * Lessons (migration 0089, services/calls/lessons.ts) against real SQLite with
 * every migration: the back-fill of 2 Oct 2026's four calls into ONE lesson,
 * a new call joining the lesson within two hours (and not after), the lesson
 * report queued once every call is transcribed, and the lesson's material.
 */
import { describe, it, expect, vi } from 'vitest';
import { createSqliteD1, applyMigrationsFrom, type SqliteD1 } from './sqlite-d1';
import { lessonForNewCall, lessonMaterial, advanceLessonProcessing, refreshLessonEnd, reportIsCurrent, getLesson, lessonCalls } from '../calls/lessons';
import { LESSON_GAP_MS } from '@shared/calls';

const T = (hhmm: string) => Date.parse(`2026-10-02T${hhmm}:00Z`);
const sqlTime = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

function seedPeople(db: SqliteD1) {
  db.raw.exec(`INSERT INTO users (id, email) VALUES ('tutor', 't@x'), ('jerome', 'j@x'), ('other', 'o@x')`);
  db.raw.exec(`INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel', 'tutor', 'jerome', 'tutor', 'active'), ('rel2', 'tutor', 'other', 'tutor', 'active')`);
}

function addCall(db: SqliteD1, id: string, rel: string | null, start: number, end: number | null, extra = '') {
  db.raw.exec(
    `INSERT INTO calls (id, relationship_id, created_by, status, started_at, ended_at, created_at${extra ? ', ' + extra.split('=')[0] : ''})
     VALUES ('${id}', ${rel ? `'${rel}'` : 'NULL'}, 'tutor', '${end === null ? 'live' : 'ended'}', ${start}, ${end ?? 'NULL'}, '${sqlTime(start)}'${extra ? ", '" + extra.split('=')[1] + "'" : ''})`,
  );
}

describe('call lessons', () => {
  it('back-fills 2 Oct 2026: four calls in a row are one lesson; other people and other days are not', async () => {
    const db = await createSqliteD1({ stopBefore: '0089' });
    seedPeople(db);
    addCall(db, 'c1', 'rel', T('12:31'), T('12:53'), "summary_json={\"summary\":\"one\"}");
    addCall(db, 'c2', 'rel', T('12:54'), T('13:11'));
    addCall(db, 'c3', 'rel', T('13:12'), T('13:28'));
    addCall(db, 'c4', 'rel', T('13:32'), T('13:32') + 4000);
    addCall(db, 'x1', 'rel2', T('12:40'), T('12:50'), "summary_json={\"summary\":\"solo\"}");
    addCall(db, 'old', 'rel', Date.parse('2026-09-30T08:42:38Z'), Date.parse('2026-09-30T09:20:00Z'));
    db.raw.exec(`UPDATE calls SET processing_status = 'done' WHERE id = 'x1'`);
    applyMigrationsFrom(db, '0089');

    const rows = db.rows<{ id: string; lesson_id: string }>('SELECT id, lesson_id FROM calls ORDER BY id');
    expect(Object.fromEntries(rows.map((r) => [r.id, r.lesson_id]))).toEqual({ c1: 'c1', c2: 'c1', c3: 'c1', c4: 'c1', old: 'old', x1: 'x1' });
    const lessons = db.rows<{ id: string; last_ended_at: number; processing_status: string; summary_json: string | null }>('SELECT id, last_ended_at, processing_status, summary_json FROM call_lessons ORDER BY id');
    expect(lessons.map((l) => l.id)).toEqual(['c1', 'old', 'x1']);
    const c1 = lessons.find((l) => l.id === 'c1')!;
    expect(c1.last_ended_at).toBe(T('13:32') + 4000);
    // Several calls: the combined report is written on first view, not copied from one call.
    expect(c1.processing_status).toBe('none');
    expect(c1.summary_json).toBeNull();
    const x1 = lessons.find((l) => l.id === 'x1')!;
    expect(x1.processing_status).toBe('done');
    expect(JSON.parse(x1.summary_json!)).toEqual({ summary: 'solo' });
  });

  it('a new call within two hours of the last one joins its lesson; later, a new lesson', async () => {
    const db = await createSqliteD1();
    seedPeople(db);
    const first = await lessonForNewCall(db, 'rel', 'tutor', T('10:00'));
    addCall(db, 'a', 'rel', T('10:00'), null, `lesson_id=${first}`);
    // While live: a second call (the other person's device) is the same lesson.
    expect(await lessonForNewCall(db, 'rel', 'jerome', T('10:05'))).toBe(first);
    db.raw.exec(`UPDATE calls SET status = 'ended', ended_at = ${T('10:30')} WHERE id = 'a'`);
    await refreshLessonEnd(db, first);
    expect((await getLesson(db, first))!.last_ended_at).toBe(T('10:30'));
    expect(LESSON_GAP_MS).toBe(2 * 60 * 60_000); // round 5: two hours, not 20 minutes
    expect(await lessonForNewCall(db, 'rel', 'tutor', T('12:00'))).toBe(first); // back after 1 h 30
    db.raw.exec(`UPDATE call_lessons SET last_ended_at = ${T('10:30')} WHERE id = '${first}'`);
    expect(await lessonForNewCall(db, 'rel', 'tutor', T('10:30') + LESSON_GAP_MS)).toBe(first);
    expect((await getLesson(db, first))!.last_ended_at).toBeNull(); // open again
    db.raw.exec(`UPDATE call_lessons SET last_ended_at = ${T('10:30')} WHERE id = '${first}'`);
    const next = await lessonForNewCall(db, 'rel', 'tutor', T('10:30') + LESSON_GAP_MS + 1);
    expect(next).not.toBe(first);
    // Other people never share a lesson.
    expect(await lessonForNewCall(db, 'rel2', 'tutor', T('10:31'))).not.toBe(next);
  });

  it('queues the lesson report once every call is transcribed; a later call makes it stale', async () => {
    const db = await createSqliteD1();
    seedPeople(db);
    const lesson = await lessonForNewCall(db, 'rel', 'tutor', T('12:31'));
    addCall(db, 'c1', 'rel', T('12:31'), T('12:53'), `lesson_id=${lesson}`);
    addCall(db, 'c2', 'rel', T('12:54'), T('13:11'), `lesson_id=${lesson}`);
    db.raw.exec(`UPDATE calls SET processing_status = 'transcribing' WHERE id = 'c2'; UPDATE calls SET processing_status = 'done' WHERE id = 'c1'`);
    const sent: unknown[] = [];
    const env = { DB: db, CALL_QUEUE: { send: vi.fn(async (m: unknown) => void sent.push(m)) } } as never;
    await advanceLessonProcessing(env, lesson);
    expect(sent).toEqual([]);
    expect((await getLesson(db, lesson))!.processing_status).toBe('waiting');
    db.raw.exec(`UPDATE calls SET processing_status = 'done' WHERE id = 'c2'`);
    await advanceLessonProcessing(env, lesson);
    await advanceLessonProcessing(env, lesson); // idempotent
    expect(sent).toEqual([{ kind: 'lesson_report', lessonId: lesson }]);
    // The report was written for c1 + c2 …
    db.raw.exec(`UPDATE call_lessons SET processing_status = 'done', report_call_ids = '["c1","c2"]' WHERE id = '${lesson}'`);
    expect(reportIsCurrent((await getLesson(db, lesson))!, await lessonCalls(db, lesson))).toBe(true);
    // … then a third call joined: stale, written again when it is transcribed.
    addCall(db, 'c3', 'rel', T('13:12'), T('13:28'), `lesson_id=${lesson}`);
    db.raw.exec(`UPDATE calls SET processing_status = 'done' WHERE id = 'c3'`);
    await advanceLessonProcessing(env, lesson);
    expect(sent).toHaveLength(2);
  });

  it("gathers the lesson's material: every call's transcript and chat; each page once, with its latest text", async () => {
    const db = await createSqliteD1();
    seedPeople(db);
    const lesson = await lessonForNewCall(db, 'rel', 'tutor', T('12:31'));
    addCall(db, 'c1', 'rel', T('12:31'), T('12:53'), `lesson_id=${lesson}`);
    addCall(db, 'c2', 'rel', T('12:54'), T('13:11'), `lesson_id=${lesson}`);
    db.raw.exec(`UPDATE calls SET chat_json = '[{"id":"m1","user_id":"tutor","name":"T","text":"你好","at":1}]' WHERE id = 'c1'`);
    db.raw.exec(`UPDATE calls SET chat_json = '[{"id":"m2","user_id":"jerome","name":"J","text":"好的","at":2}]' WHERE id = 'c2'`);
    db.raw.exec(`INSERT INTO call_recording_pieces (id, call_id, user_id, piece_index, started_at, mime_type) VALUES ('p1','c1','tutor',0,${T('12:31')},'audio/webm'), ('p2','c2','jerome',0,${T('12:54')},'audio/webm')`);
    db.raw.exec(`INSERT INTO call_transcript_segments (id, call_id, piece_id, user_id, start_ms, end_ms, text) VALUES ('s2','c2','p2','jerome',${T('12:55')},${T('12:55') + 2000},'第二'), ('s1','c1','p1','tutor',${T('12:32')},${T('12:32') + 2000},'第一')`);
    db.raw.exec(`INSERT INTO board_pages (id, relationship_id, owner_id, position, title, doc_json, text, created_in_call_id, last_used_at, created_at, updated_at) VALUES ('pg', 'rel', 'tutor', 0, NULL, '{}', '', 'c1', 0, 0, 0)`);
    db.raw.exec(`INSERT INTO call_board_pages (call_id, page_id, text, edited, opened_at) VALUES ('c1','pg','我把',1,1), ('c2','pg','我把作业做完了',1,2)`);
    const m = (await lessonMaterial(db, lesson))!;
    expect(m.segments.map((s) => s.text)).toEqual(['第一', '第二']);
    expect(m.chat.map((x) => x.text)).toEqual(['你好', '好的']);
    expect(m.pages).toEqual([{ page_id: 'pg', number: 1, title: null, text: '我把作业做完了', edited: true }]);
    expect(m.boardText).toBe('我把作业做完了');
  });
});
