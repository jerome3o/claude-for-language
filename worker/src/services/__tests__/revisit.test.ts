/** "Revisit later" on the server: settings + Done-for-good events against real SQLite (every migration). */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import {
  addRevisitEvents,
  getRevisitSettingsInfo,
  listRevisitEvents,
  revisitSummaries,
  setRevisitSettings,
} from '../revisit';
import { DEFAULT_REVISIT_SETTINGS } from '@shared/study/revisit';

let db: SqliteD1;
const exec = (sql: string, ...params: (string | number | null)[]) => db.raw.run(sql, params);

beforeEach(async () => {
  db = await createSqliteD1();
  for (const id of ['u1', 'u2']) exec('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', id, `${id}@example.com`, id);
  exec("INSERT INTO custom_lessons (id, user_id, title, spec) VALUES ('l1', 'u1', 'Tones', '{}')");
  exec("INSERT INTO custom_lessons (id, user_id, title, spec) VALUES ('l-other', 'u2', 'Not mine', '{}')");
  exec("INSERT INTO graded_readers (id, user_id, title_chinese, title_english, difficulty_level, source_deck_ids, vocabulary_used) VALUES ('r1', 'u1', '小猫', 'Kitten', 'beginner', '[]', '[]')");
});

describe('revisit settings', () => {
  it('defaults until changed; null / reset goes back to the defaults (stored as NULL)', async () => {
    expect(await getRevisitSettingsInfo(db, 'u1')).toEqual({ ...DEFAULT_REVISIT_SETTINGS, is_default: true });
    const saved = await setRevisitSettings(db, 'u1', { good_days: 10, growth: 1.5 });
    expect(saved).toMatchObject({ good_days: 10, growth: 1.5, is_default: false });
    expect(await getRevisitSettingsInfo(db, 'u1')).toMatchObject({ good_days: 10, growth: 1.5 });
    await setRevisitSettings(db, 'u1', { good_days: null, growth: null });
    expect(db.rows<{ revisit_settings: string | null }>("SELECT revisit_settings FROM users WHERE id = 'u1'")[0].revisit_settings).toBeNull();
  });
});

describe('revisit events', () => {
  it('stores the caller\'s events once (idempotent by id), skips other people\'s items and junk', async () => {
    const at = '2026-10-06T10:00:00.000Z';
    const res = await addRevisitEvents(db, 'u1', [
      { id: 'e1', item_kind: 'lesson', item_id: 'l1', action: 'retire', created_at: at },
      { id: 'e2', item_kind: 'reader', item_id: 'r1', action: 'retire', created_at: at },
      { id: 'e3', item_kind: 'lesson', item_id: 'l-other', action: 'retire', created_at: at },
      { id: 'e4', item_kind: 'deck', item_id: 'x', action: 'retire', created_at: at },
    ]);
    expect(res).toEqual({ accepted: ['e1', 'e2'], orphans: ['e3'], invalid: 1 });
    await addRevisitEvents(db, 'u1', [{ id: 'e1', item_kind: 'lesson', item_id: 'l1', action: 'retire', created_at: at }]);
    expect((await listRevisitEvents(db, 'u1')).map(e => e.id)).toEqual(['e1', 'e2']);
    expect(await listRevisitEvents(db, 'u2')).toEqual([]);
  });

  it('summaries for the tutor: next revisit from the ratings, done for good from the events', async () => {
    exec("INSERT INTO custom_lesson_completions (id, user_id, lesson_id, correct, total, completed_at, rating) VALUES ('c1', 'u1', 'l1', 1, 1, '2026-10-01T09:00:00.000Z', 2)");
    exec("INSERT INTO reader_review_events (id, user_id, reader_id, rating, reviewed_at) VALUES ('rv1', 'u1', 'r1', 3, '2026-10-01T09:00:00.000Z')");
    let s = await revisitSummaries(db, 'u1', 'lesson', ['l1']);
    expect(s.get('l1')).toEqual({ next_revisit_at: '2026-10-15T09:00:00.000Z', retired: false });
    s = await revisitSummaries(db, 'u1', 'reader', ['r1']);
    expect(s.get('r1')).toEqual({ next_revisit_at: '2026-11-12T09:00:00.000Z', retired: false });
    await addRevisitEvents(db, 'u1', [{ id: 'x', item_kind: 'lesson', item_id: 'l1', action: 'retire', created_at: '2026-10-02T00:00:00.000Z' }]);
    s = await revisitSummaries(db, 'u1', 'lesson', ['l1']);
    expect(s.get('l1')).toEqual({ next_revisit_at: null, retired: true });
  });
});
