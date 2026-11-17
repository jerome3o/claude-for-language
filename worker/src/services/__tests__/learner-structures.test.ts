/**
 * The learner's lesson structures cache (services/learner-structures.ts, migration 0151) against real SQLite
 * with every migration: built from done lessons only, cached by a fingerprint, rebuilt when a lesson is done
 * or edited; and the sentence generator's learner context (services/sentence-learner-context.ts).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { getLearnerStructures, learnerStructuresStamp } from '../learner-structures';
import { sentenceLearnerContext } from '../sentence-learner-context';

const ME = 'user-1';

const besides = {
  title: '除了',
  sections: [{ exercises: [{ type: 'note', patterns: [{ name: '除了…还…', pieces: [{ hanzi: '除了' }, { slot: 'Noun' }, { hanzi: '，' }, { hanzi: '还' }, { slot: 'Verb' }], meaning: 'besides A, also B' }] }] }],
};
const planned = {
  title: '本来',
  sections: [{ exercises: [{ type: 'note', body: '① 本来 + 动词 + ，后来 + 动词\n→ originally …, later …' }] }],
};

function seed(db: SqliteD1) {
  db.raw.run('INSERT INTO users (id, email, name, bio) VALUES (?, ?, ?, ?)', [ME, 'me@x.test', 'Jerome', 'I like trains']);
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d-1', ?, 'HSK 2')", [ME]);
  db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n-bank', 'd-1', '银行', 'yínháng', 'bank')");
  db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n-go', 'd-1', '去', 'qù', 'to go')");
  db.raw.run("INSERT INTO cards (id, note_id, card_type, queue) VALUES ('c-go', 'n-go', 'hanzi_to_meaning', 2)");
  db.raw.run("INSERT INTO custom_lessons (id, user_id, title, spec, updated_at) VALUES ('l-1', ?, '除了', ?, '2026-10-01 00:00:00')", [ME, JSON.stringify(besides)]);
  db.raw.run("INSERT INTO custom_lessons (id, user_id, title, spec, updated_at) VALUES ('l-2', ?, '本来', ?, '2026-10-01 00:00:00')", [ME, JSON.stringify(planned)]);
}

describe('learner structures cache', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
  });

  it('is built from done lessons only, cached, and rebuilt when a lesson is done', async () => {
    const d1 = db as unknown as D1Database;
    expect(await getLearnerStructures(d1, ME)).toEqual([]);
    db.raw.run("INSERT INTO custom_lesson_completions (id, user_id, lesson_id, correct, total, completed_at) VALUES ('c1', ?, 'l-1', 3, 4, '2026-11-01T10:00:00Z')", [ME]);
    const first = await getLearnerStructures(d1, ME);
    expect(first.map((s) => s.name)).toEqual(['除了…还…']);
    const row = (await d1.prepare('SELECT stamp FROM learner_structures WHERE user_id = ?').bind(ME).first<{ stamp: string }>())!;
    expect(row.stamp).toBe(await learnerStructuresStamp(d1, ME));

    // Same fingerprint → the cached row is used as is.
    db.raw.run("UPDATE learner_structures SET structures = '[{\"name\":\"cached\"}]' WHERE user_id = ?", [ME]);
    expect((await getLearnerStructures(d1, ME)).map((s) => s.name)).toEqual(['cached']);

    // Another lesson done → rebuilt.
    db.raw.run("INSERT INTO custom_lesson_completions (id, user_id, lesson_id, correct, total, completed_at) VALUES ('c2', ?, 'l-2', 3, 4, '2026-11-05T10:00:00Z')", [ME]);
    const second = await getLearnerStructures(d1, ME);
    expect(second.map((s) => s.name)).toEqual(['本来…后来…', '除了…还…']);
  });

  it('gives the sentence generator his bio, known words and structures', async () => {
    db.raw.run("INSERT INTO custom_lesson_completions (id, user_id, lesson_id, correct, total, completed_at) VALUES ('c1', ?, 'l-1', 3, 4, '2026-11-01T10:00:00Z')", [ME]);
    const ctx = await sentenceLearnerContext(db as unknown as D1Database, 'n-bank', '银行');
    expect(ctx.userId).toBe(ME);
    expect(ctx.bio).toBe('I like trains');
    expect(ctx.knownWords).toEqual(['去']);
    expect(ctx.structures.map((s) => s.name)).toEqual(['除了…还…']);
    const none = await sentenceLearnerContext(db as unknown as D1Database, 'n-missing');
    expect(none).toEqual({ userId: null, bio: null, knownWords: [], structures: [] });
  });
});
