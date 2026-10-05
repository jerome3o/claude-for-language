/**
 * The homework library, link homework and updating students' copies, against
 * a REAL SQLite with every migration (docs/HOMEWORK.md §8–10).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { assignHomework, parseAssignItems, recordEvents } from '../homework';
import { listStudentCopies, relationshipLibrary, tutorLibrary, updateStudentCopies } from '../homework-library';
import { insertLink, updateLink } from '../../db/homework-links-queries';
import * as hw from '../../db/homework-queries';
import type { Env } from '../../types';

const TUTOR = 'tutor-1';
const STUDENT = 'student-1';
const OTHER = 'student-2';
const STUDENT_REF = { relationship_id: 'rel-1', student_id: STUDENT, student_name: 'Anna' };
const TODAY = '2026-10-03';

function exec(db: SqliteD1, sql: string, ...params: unknown[]) {
  const stmt = db.raw.prepare(sql);
  stmt.run(params as never);
  stmt.free();
}

function rows<T>(db: SqliteD1, sql: string, ...params: unknown[]): T[] {
  const stmt = db.raw.prepare(sql);
  stmt.bind(params as never);
  const out: T[] = [];
  while (stmt.step()) out.push(stmt.getAsObject() as T);
  stmt.free();
  return out;
}

function seed(db: SqliteD1) {
  exec(db, "INSERT INTO users (id, email, name, role) VALUES (?, 't@x.com', 'Minghui', 'tutor')", TUTOR);
  exec(db, "INSERT INTO users (id, email, name) VALUES (?, 'a@x.com', 'Anna')", STUDENT);
  exec(db, "INSERT INTO users (id, email, name) VALUES (?, 'b@x.com', 'Ben')", OTHER);
  exec(db, "INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'tutor', 'active')", TUTOR, STUDENT);
  exec(db, "INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-2', ?, ?, 'tutor', 'active')", TUTOR, OTHER);

  // A deck already shared (before assignments): 2 words, one met.
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('t-food', ?, 'Food')", TUTOR);
  exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('t-n1', 't-food', '米饭', 'mǐfàn', 'rice')");
  exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('t-n2', 't-food', '面条', 'miàntiáo', 'noodles')");
  exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('t-n3', 't-food', '饺子', 'jiǎozi', 'dumplings')");
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('s-food', ?, 'Food')", STUDENT);
  exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('s-n1', 's-food', '米饭', 'mǐfàn', 'rice')");
  exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('s-n2', 's-food', '面条', 'miàntiáo', 'noodles')");
  exec(db, "INSERT INTO cards (id, note_id, card_type, queue) VALUES ('s-c1', 's-n1', 'hanzi_to_meaning', 2)");
  exec(db, "INSERT INTO cards (id, note_id, card_type, queue) VALUES ('s-c2', 's-n2', 'hanzi_to_meaning', 0)");
  exec(db, "INSERT INTO shared_decks (id, relationship_id, source_deck_id, target_deck_id, shared_at) VALUES ('share-1', 'rel-1', 't-food', 's-food', '2026-09-20T10:00:00Z')");

  // A reader shared, 2 pages; the tutor's now has 3 and a changed page 1.
  exec(db, "INSERT INTO graded_readers (id, user_id, title_chinese, title_english, difficulty_level, status, source_deck_ids, vocabulary_used) VALUES ('t-r', ?, '小明', 'Xiaoming', 'beginner', 'ready', '[]', '[]')", TUTOR);
  exec(db, "INSERT INTO reader_pages (id, reader_id, page_number, content_chinese, content_pinyin, content_english, image_url) VALUES ('tp1', 't-r', 1, '小明在巴黎。', 'Xiǎomíng zài Bālí.', 'Xiaoming is in Paris.', 'reader-images/new1.png')");
  exec(db, "INSERT INTO reader_pages (id, reader_id, page_number, content_chinese, content_pinyin, content_english) VALUES ('tp2', 't-r', 2, '他很开心。', 'Tā hěn kāixīn.', 'He is happy.')");
  exec(db, "INSERT INTO reader_pages (id, reader_id, page_number, content_chinese, content_pinyin, content_english) VALUES ('tp3', 't-r', 3, '再见！', 'Zàijiàn!', 'Bye!')");
  exec(db, "INSERT INTO graded_readers (id, user_id, title_chinese, title_english, difficulty_level, status, source_deck_ids, vocabulary_used) VALUES ('s-r', ?, '小明', 'Xiaoming', 'beginner', 'ready', '[]', '[]')", STUDENT);
  exec(db, "INSERT INTO reader_pages (id, reader_id, page_number, content_chinese, content_pinyin, content_english, image_url) VALUES ('sp1', 's-r', 1, '小明在北京。', 'Xiǎomíng zài Běijīng.', 'Xiaoming is in Beijing.', 'reader-images/old1.png')");
  exec(db, "INSERT INTO reader_pages (id, reader_id, page_number, content_chinese, content_pinyin, content_english) VALUES ('sp2', 's-r', 2, '他很开心。', 'Tā hěn kāixīn.', 'He is happy.')");
  exec(db, "INSERT INTO shared_readers (id, relationship_id, source_reader_id, target_reader_id, shared_at) VALUES ('rs-1', 'rel-1', 't-r', 's-r', '2026-09-25T10:00:00Z')");
  exec(db, "INSERT INTO reader_review_events (id, reader_id, user_id, rating, reviewed_at) VALUES ('rr1', 's-r', ?, 2, '2026-09-26T10:00:00Z')", STUDENT);
}

describe('homework library', () => {
  let db: SqliteD1;
  let env: Env;
  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
    env = { DB: db } as unknown as Env;
  });

  it('link homework: created in the tutor account, nothing sent until she sends it; done + note shows Completed', async () => {
    const link = await insertLink(db, TUTOR, { title: '月亮代表我的心', url: 'https://youtu.be/dQw4w9WgXcQ', instructions: 'Listen twice, note 5 words', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' });
    expect(rows(db, 'SELECT id FROM assignments')).toHaveLength(0);

    const items = parseAssignItems([{ kind: 'link', source_id: link.id, due_date: null }]);
    expect(items[0].mode).toBe('one_off');
    const result = await assignHomework(env, { relationshipId: 'rel-1', tutorId: TUTOR, studentId: STUDENT, items, today: TODAY });
    expect(result.errors).toEqual([]);
    const [a] = result.assignments;
    expect(a).toMatchObject({ kind: 'link', mode: 'one_off', due_date: null, item_count: 1, target_id: link.id, details: { url: 'https://youtu.be/dQw4w9WgXcQ', instructions: 'Listen twice, note 5 words' } });

    // The student sees it in their sync, with the link.
    const mine = await hw.listStudentAssignments(db, STUDENT);
    expect(mine[0].details?.url).toBe('https://youtu.be/dQw4w9WgXcQ');

    let lib = await relationshipLibrary(db, TUTOR, STUDENT_REF, TODAY);
    expect(lib.find((i) => i.kind === 'link')).toMatchObject({ status: 'not_started', percent: 0, due_date: null });

    const recorded = await recordEvents(db, STUDENT, [{ id: 'e1', assignment_id: a.id, item_id: link.id, result: 'done', created_at: '2026-10-03T09:00:00Z', note: '  学会了五个词！ ' }]);
    expect(recorded.assignments[0].status).toBe('done');
    lib = await relationshipLibrary(db, TUTOR, STUDENT_REF, TODAY);
    expect(lib.find((i) => i.kind === 'link')).toMatchObject({ status: 'completed', percent: 100, student_note: '学会了五个词！' });
  });

  it('a link that is not the tutor’s cannot be sent', async () => {
    const link = await insertLink(db, OTHER, { title: 'x', url: 'https://example.com', instructions: null, thumbnail_url: null });
    const result = await assignHomework(env, { relationshipId: 'rel-1', tutorId: TUTOR, studentId: STUDENT, items: parseAssignItems([{ kind: 'link', source_id: link.id }]), today: TODAY });
    expect(result.assignments).toHaveLength(0);
    expect(result.errors[0].error).toMatch(/not found/);
  });

  it('lists decks (words met, long-term) and readers (read) with their status, newest first', async () => {
    const lib = await relationshipLibrary(db, TUTOR, STUDENT_REF, TODAY);
    expect(lib.map((i) => i.kind)).toEqual(['reader', 'deck']);
    expect(lib[0]).toMatchObject({ title: 'Xiaoming', status: 'completed', source_id: 't-r', target_id: 's-r', share_id: 'rs-1' });
    expect(lib[1]).toMatchObject({ title: 'Food', percent: 50, progress: '1 / 2 words met', status: 'long_term', behind: 1, mode: null });

    const all = await tutorLibrary(db, TUTOR, TODAY);
    expect(all.students.map((s) => s.student_name).sort()).toEqual(['Anna', 'Ben']);
    expect(all.items).toHaveLength(2);
  });

  it('lists the copies of a source and updates a deck copy (new words added, progress kept)', async () => {
    const copies = await listStudentCopies(db, TUTOR, 'deck', 't-food');
    expect(copies).toEqual([{ relationship_id: 'rel-1', student_id: STUDENT, student_name: 'Anna', target_id: 's-food', share_id: 'share-1', behind: 1 }]);
    const res = await updateStudentCopies(env, TUTOR, 'deck', 't-food', null);
    expect(res.results[0]).toMatchObject({ ok: true, student_name: 'Anna' });
    expect(res.results[0].detail).toContain('1 new word');
    expect(rows<{ hanzi: string }>(db, "SELECT hanzi FROM notes WHERE deck_id = 's-food' ORDER BY hanzi").map((r) => r.hanzi).sort()).toEqual(['米饭', '面条', '饺子'].sort());
    // The met word still has its card state.
    expect(rows<{ queue: number }>(db, "SELECT queue FROM cards WHERE id = 's-c1'")[0].queue).toBe(2);
  });

  it('updates a reader copy keeping the copy’s page ids (and its reading history)', async () => {
    const res = await updateStudentCopies(env, TUTOR, 'reader', 't-r', ['rel-1']);
    expect(res.results[0]).toMatchObject({ ok: true, detail: '2 pages updated' });
    const pages = rows<{ id: string; content_chinese: string; image_url: string | null }>(db, "SELECT id, content_chinese, image_url FROM reader_pages WHERE reader_id = 's-r' ORDER BY page_number");
    expect(pages.map((p) => p.content_chinese)).toEqual(['小明在巴黎。', '他很开心。', '再见！']);
    expect(pages[0]).toMatchObject({ id: 'sp1', image_url: 'reader-images/new1.png' });
    expect(pages[1].id).toBe('sp2');
    expect(rows(db, "SELECT id FROM reader_review_events WHERE reader_id = 's-r'")).toHaveLength(1);
    // A second run has nothing to do.
    const again = await updateStudentCopies(env, TUTOR, 'reader', 't-r', null);
    expect(again.results[0].detail).toBe('already up to date');
  });

  it('updates sent links when the tutor edits hers; other students stay as they were when not chosen', async () => {
    const link = await insertLink(db, TUTOR, { title: 'Song', url: 'https://example.com/a', instructions: null, thumbnail_url: null });
    for (const [rel, student] of [['rel-1', STUDENT], ['rel-2', OTHER]] as const) {
      await assignHomework(env, { relationshipId: rel, tutorId: TUTOR, studentId: student, items: parseAssignItems([{ kind: 'link', source_id: link.id }]), today: TODAY });
    }
    expect((await listStudentCopies(db, TUTOR, 'link', link.id)).map((c) => c.student_name).sort()).toEqual(['Anna', 'Ben']);
    await updateLink(db, link.id, TUTOR, { title: 'Song (live)', url: 'https://example.com/b' });
    const res = await updateStudentCopies(env, TUTOR, 'link', link.id, ['rel-1']);
    expect(res.results).toHaveLength(1);
    const titles = rows<{ relationship_id: string; title: string; details: string }>(db, "SELECT relationship_id, title, details FROM assignments WHERE kind = 'link' ORDER BY relationship_id");
    expect(titles[0]).toMatchObject({ relationship_id: 'rel-1', title: 'Song (live)' });
    expect(JSON.parse(titles[0].details).url).toBe('https://example.com/b');
    expect(titles[1]).toMatchObject({ relationship_id: 'rel-2', title: 'Song' });
  });

  it('refuses sources that are not the caller’s', async () => {
    await expect(listStudentCopies(db, OTHER, 'deck', 't-food')).rejects.toThrow(/not found/);
  });
});
