/** The legacy Done-for-good marks on the server against real SQLite (every migration). */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { addRevisitEvents, listRevisitEvents, LEGACY_REVISIT_SETTINGS } from '../revisit';
import revisitRoutes from '../../routes/revisit';

let db: SqliteD1;
const exec = (sql: string, ...params: (string | number | null)[]) => db.raw.run(sql, params);

beforeEach(async () => {
  db = await createSqliteD1();
  for (const id of ['u1', 'u2']) exec('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', id, `${id}@example.com`, id);
  exec("INSERT INTO custom_lessons (id, user_id, title, spec) VALUES ('l1', 'u1', 'Tones', '{}')");
  exec("INSERT INTO custom_lessons (id, user_id, title, spec) VALUES ('l-other', 'u2', 'Not mine', '{}')");
  exec("INSERT INTO graded_readers (id, user_id, title_chinese, title_english, difficulty_level, source_deck_ids, vocabulary_used) VALUES ('r1', 'u1', '小猫', 'Kitten', 'beginner', '[]', '[]')");
});

describe('legacy settings (older app builds)', () => {
  it('PUT /profile/revisit-settings is a harmless no-op answering the old defaults', async () => {
    const res = await revisitRoutes.request('/profile/revisit-settings', { method: 'PUT', body: JSON.stringify({ good_days: 10 }), headers: { 'Content-Type': 'application/json' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hard_days: 2, good_days: 14, easy_days: 42, growth: 2, cap_days: 180, new_lessons_per_day: 1, is_default: true });
    expect(LEGACY_REVISIT_SETTINGS.is_default).toBe(true);
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
});
