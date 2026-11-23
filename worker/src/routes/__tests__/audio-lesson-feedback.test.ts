/**
 * Feedback while listening (routes/audio-lesson-feedback.ts + services/audio-lesson-feedback.ts) against real
 * SQLite with every migration: events stored idempotently by client id, only on my own lessons, junk refused,
 * read back grouped per lesson with the summary Claude reads; a deleted lesson takes its feedback with it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import feedbackRoutes from '../audio-lesson-feedback';
import type { Env } from '../../types';

const ME = 'user-1';
const OTHER = 'user-2';

function seed(db: SqliteD1) {
  db.raw.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', [ME, 'me@x.test', 'Jerome']);
  db.raw.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', [OTHER, 'o@x.test', 'Other']);
  db.raw.run("INSERT INTO audio_lessons (id, user_id, title, format, status, duration_ms) VALUES ('al-1', ?, 'At the noodle shop', 'story', 'ready', 600000)", [ME]);
  db.raw.run("INSERT INTO audio_lessons (id, user_id, title, format, status, duration_ms) VALUES ('al-2', ?, 'Post office words', 'sleep', 'ready', 900000)", [ME]);
  db.raw.run("INSERT INTO audio_lessons (id, user_id, title, format, status) VALUES ('al-x', ?, 'Theirs', 'story', 'ready')", [OTHER]);
}

function client(env: Env, userId: string) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', async (c, next) => {
    c.set('user', { id: userId } as never);
    await next();
  });
  app.route('/api', feedbackRoutes);
  return async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
}

const row = (index: number, text: string, start_ms: number) => ({ index, start_ms, text, pinyin: 'pīnyīn', english: 'English' });

function ev(id: string, kind: string, position_ms: number, extra: Record<string, unknown> = {}) {
  return {
    id, audio_lesson_id: 'al-1', kind, where: 'lock_screen', position_ms, chapter_index: 1, row_index: 4,
    row: row(4, '他很累。', 40_000), previous_row: row(3, '小明起床了。', 30_000), speed: 1, audio_version: 'v2',
    created_at: new Date(Date.UTC(2026, 10, 23, 8, 0, 0) + position_ms).toISOString(), ...extra,
  };
}

describe('audio lesson feedback', () => {
  let db: SqliteD1;
  let me: ReturnType<typeof client>;
  let other: ReturnType<typeof client>;

  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
    me = client({ DB: db } as unknown as Env, ME);
    other = client({ DB: db } as unknown as Env, OTHER);
  });

  it('stores presses idempotently on my own lesson, junk refused', async () => {
    const events = [ev('fb-aaaaaa1', 'too_hard', 45_000), ev('fb-aaaaaa2', 'again', 46_000), ev('fb-aaaaaa3', 'back_section', 41_000), ev('fb-bad001', 'meh', 1)];
    const r = await me('POST', '/audio-lessons/al-1/feedback', { events });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ accepted: ['fb-aaaaaa1', 'fb-aaaaaa2', 'fb-aaaaaa3'], stored: 3, rejected: ['fb-bad001'] });
    const again = await me('POST', '/audio-lessons/al-1/feedback', { events: events.slice(0, 2) });
    expect(again.json).toMatchObject({ stored: 0, accepted: ['fb-aaaaaa1', 'fb-aaaaaa2'] });

    expect((await me('POST', '/audio-lessons/al-1/feedback', { events: [] })).status).toBe(400);
    expect((await me('POST', '/audio-lessons/al-1/feedback', { events: Array.from({ length: 101 }, (_, i) => ev(`fb-many-${i}`, 'skip', i)) })).status).toBe(400);
    // Another account's lesson is not found; my id can't be re-used to write into it.
    expect((await me('POST', '/audio-lessons/al-x/feedback', { events: [ev('fb-x00001', 'too_hard', 1)] })).status).toBe(404);
    expect((await other('POST', '/audio-lessons/al-1/feedback', { events: [ev('fb-x00002', 'too_hard', 1)] })).status).toBe(404);
    // An event naming another lesson in its body is refused.
    const wrong = await me('POST', '/audio-lessons/al-2/feedback', { events: [ev('fb-wrong01', 'too_hard', 1)] });
    expect(wrong.json).toMatchObject({ stored: 0, rejected: ['fb-wrong01'] });
  });

  it('reads it back per lesson with the summary, mine only, after a cursor', async () => {
    await me('POST', '/audio-lessons/al-1/feedback', { events: [ev('fb-aaaaaa1', 'too_hard', 45_000), ev('fb-aaaaaa2', 'too_hard', 47_000), ev('fb-aaaaaa3', 'again', 48_000)] });
    await me('POST', '/audio-lessons/al-2/feedback', { events: [{ ...ev('fb-bbbbbb1', 'skip', 5_000), audio_lesson_id: 'al-2', created_at: '2026-11-24T07:00:00.000Z' }] });

    const all = await me('GET', '/me/audio-lesson-feedback');
    expect(all.status).toBe(200);
    expect(all.json.lessons.map((l: any) => l.lesson.id)).toEqual(['al-2', 'al-1']); // the newest press first
    const story = all.json.lessons[1];
    expect(story.lesson).toMatchObject({ title: 'At the noodle shop', format: 'story', duration_ms: 600000, listened_at: null });
    expect(story.events.map((e: any) => [e.id, e.kind, e.where, e.row?.text])).toEqual([
      ['fb-aaaaaa1', 'too_hard', 'lock_screen', '他很累。'],
      ['fb-aaaaaa2', 'too_hard', 'lock_screen', '他很累。'],
      ['fb-aaaaaa3', 'again', 'lock_screen', '他很累。'],
    ]);
    expect(story.summary.counts).toEqual({ too_hard: 2, back_section: 0, again: 1, skip: 0 });
    expect(story.summary.rows[0]).toMatchObject({ index: 4, text: '他很累。', too_hard: 2, replays: 1 });
    expect(story.summary.line).toBe('Too hard ×2 · went back ×1 — hardest: 他很累。 (too hard ×2, replayed ×1)');

    const one = await me('GET', '/me/audio-lesson-feedback?lesson_id=al-1');
    expect(one.json.lessons.map((l: any) => l.lesson.id)).toEqual(['al-1']);
    expect((await other('GET', '/me/audio-lesson-feedback')).json.lessons).toEqual([]);
    const later = await me('GET', `/me/audio-lesson-feedback?since=${encodeURIComponent(all.json.cursor)}`);
    expect(later.json.lessons).toEqual([]);
    const limited = await me('GET', '/me/audio-lesson-feedback?limit=2');
    expect(limited.json.more).toBe(true);
  });

  it('a deleted lesson takes its feedback with it', async () => {
    await me('POST', '/audio-lessons/al-1/feedback', { events: [ev('fb-aaaaaa1', 'too_hard', 45_000)] });
    db.raw.run("DELETE FROM audio_lessons WHERE id = 'al-1'");
    expect((await me('GET', '/me/audio-lesson-feedback')).json.lessons).toEqual([]);
  });
});
