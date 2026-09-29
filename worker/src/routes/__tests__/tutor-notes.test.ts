/**
 * GET /api/me/tutor-notes — the student's "Notes from your tutor" page: needs-work comments on
 * their own recordings and tutor replies to cards they flagged, new AND seen, newest first, paged.
 * Student-scoped: someone else's recordings / flags never show. Real SQLite with every migration.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../../types';
import recordingNotes, { parseTutorNotesCursor, type StudentTutorNote } from '../recording-notes';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';

const TUTOR = 'tutor-mh';
const STUDENT = 'student-j';
const OTHER = 'student-other';

let db: SqliteD1;

function exec(sql: string, ...params: Array<string | number | null>) {
  db.raw.run(sql, params);
}

function app(userId: string) {
  const a = new Hono<{ Bindings: Env }>();
  a.use('*', async (c, next) => {
    c.set('user', { id: userId } as never);
    await next();
  });
  a.route('/api', recordingNotes);
  const env = { DB: db } as unknown as Env;
  return async (path: string, init?: RequestInit) => {
    const res = await a.request(path, init, env);
    return { status: res.status, body: (await res.json()) as { notes: StudentTutorNote[]; next_cursor: string | null; error?: string } };
  };
}

/** A card of `owner` with one review event (a recording) and optionally a tutor mark on it. */
function recording(owner: string, n: number, mark: { comment: string; at: string; status?: string; seen?: string } | null) {
  exec("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES (?, ?, ?, ?, ?)", `note-${owner}-${n}`, `deck-${owner}`, `词${n}`, `cí${n}`, `word ${n}`);
  exec("INSERT INTO cards (id, note_id, card_type) VALUES (?, ?, 'hanzi_to_meaning')", `card-${owner}-${n}`, `note-${owner}-${n}`);
  exec(
    "INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at, recording_url) VALUES (?, ?, ?, 2, '2026-09-20', ?)",
    `ev-${owner}-${n}`, `card-${owner}-${n}`, owner, `recordings/ev-${owner}-${n}.webm`
  );
  if (mark) {
    exec(
      'INSERT INTO tutor_recording_marks (review_event_id, tutor_id, status, comment, updated_at, student_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
      `ev-${owner}-${n}`, TUTOR, mark.status ?? 'needs_work', mark.comment, mark.at, mark.seen ?? null
    );
  }
}

beforeEach(async () => {
  db = await createSqliteD1();
  for (const [id, email, name] of [[TUTOR, 'mh@example.com', '明慧老师'], [STUDENT, 'j@example.com', 'Jerome'], [OTHER, 'o@example.com', 'Other']]) {
    exec('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', id, email, name);
  }
  exec("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'student', 'active')", STUDENT, TUTOR);
  exec("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-2', ?, ?, 'student', 'active')", OTHER, TUTOR);
  exec("INSERT INTO decks (id, user_id, name) VALUES ('deck-student-j', ?, 'Lesson 8')", STUDENT);
  exec("INSERT INTO decks (id, user_id, name) VALUES ('deck-student-other', ?, 'Other deck')", OTHER);

  recording(STUDENT, 1, { comment: '第二声，不是第四声', at: '2026-09-25 10:00:00' });
  recording(STUDENT, 2, { comment: 'zh, not z', at: '2026-09-22 09:00:00', seen: '2026-09-23 08:00:00' });
  recording(STUDENT, 3, { comment: '', at: '2026-09-26 09:00:00' }); // empty comment: not a note
  recording(STUDENT, 4, { comment: 'Nice', at: '2026-09-26 09:00:00', status: 'listened' }); // listened: not a note
  recording(STUDENT, 5, null);
  recording(OTHER, 1, { comment: 'Not yours', at: '2026-09-27 09:00:00' });

  // A flag the student sent, answered; one unanswered; one from the other student, answered.
  exec(
    "INSERT INTO card_flags (id, relationship_id, student_id, tutor_id, note_id, card_id, message, status, tutor_reply, replied_at) VALUES ('flag-a', 'rel-1', ?, ?, 'note-student-j-5', 'card-student-j-5', 'I mix this up with 银行', 'resolved', '中国 — 国 is guó', '2026-09-24 12:00:00')",
    STUDENT, TUTOR
  );
  exec(
    "INSERT INTO card_flags (id, relationship_id, student_id, tutor_id, note_id, message) VALUES ('flag-open', 'rel-1', ?, ?, 'note-student-j-1', 'help')",
    STUDENT, TUTOR
  );
  exec(
    "INSERT INTO card_flags (id, relationship_id, student_id, tutor_id, note_id, message, status, tutor_reply, replied_at) VALUES ('flag-other', 'rel-2', ?, ?, 'note-student-other-1', 'x', 'resolved', 'Not yours either', '2026-09-28 12:00:00')",
    OTHER, TUTOR
  );
});

describe('GET /api/me/tutor-notes', () => {
  it('lists only new notes by default, newest first, with card fields', async () => {
    const { status, body } = await app(STUDENT)('/api/me/tutor-notes');
    expect(status).toBe(200);
    expect(body.notes.map((n) => n.id)).toEqual(['ev-student-j-1', 'flag-a']);
    expect(body.notes[0]).toMatchObject({
      kind: 'recording',
      card_id: 'card-student-j-1',
      card_type: 'hanzi_to_meaning',
      note_id: 'note-student-j-1',
      deck_id: 'deck-student-j',
      hanzi: '词1',
      pinyin: 'cí1',
      english: 'word 1',
      comment: '第二声，不是第四声',
      tutor_name: '明慧老师',
      updated_at: '2026-09-25T10:00:00Z',
      seen_at: null,
      recording_url: 'recordings/ev-student-j-1.webm',
      student_message: null,
    });
    expect(body.notes[1]).toMatchObject({ kind: 'flag', comment: '中国 — 国 is guó', student_message: 'I mix this up with 银行', recording_url: null, updated_at: '2026-09-24T12:00:00Z' });
    expect(body.next_cursor).toBeNull();
  });

  it('include_seen=1 adds the seen ones', async () => {
    const { body } = await app(STUDENT)('/api/me/tutor-notes?include_seen=1');
    expect(body.notes.map((n) => n.id)).toEqual(['ev-student-j-1', 'flag-a', 'ev-student-j-2']);
    expect(body.notes[2].seen_at).toBe('2026-09-23T08:00:00Z');
  });

  it('never shows another student’s recordings or flags', async () => {
    const mine = await app(STUDENT)('/api/me/tutor-notes?include_seen=1');
    expect(JSON.stringify(mine.body)).not.toContain('Not yours');
    const theirs = await app(OTHER)('/api/me/tutor-notes?include_seen=1');
    expect(theirs.body.notes.map((n) => n.id)).toEqual(['flag-other', 'ev-student-other-1']);
    // The tutor has no recordings / flags of their own: nothing, even though they wrote every note.
    const tutor = await app(TUTOR)('/api/me/tutor-notes?include_seen=1');
    expect(tutor.body.notes).toEqual([]);
  });

  it('pages with a keyset cursor across both sources without gaps or repeats', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const q: string = `/api/me/tutor-notes?include_seen=1&limit=1${cursor ? `&before=${encodeURIComponent(cursor)}` : ''}`;
      const { body } = await app(STUDENT)(q);
      seen.push(...body.notes.map((n) => n.id));
      cursor = body.next_cursor;
      pages++;
    } while (cursor && pages < 10);
    expect(seen).toEqual(['ev-student-j-1', 'flag-a', 'ev-student-j-2']);
  });

  it('a note marked seen through the existing endpoint moves out of the default list', async () => {
    const student = app(STUDENT);
    const res = await student('/api/me/recording-notes/ev-student-j-1/seen', { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await student('/api/me/tutor-notes')).body.notes.map((n) => n.id)).toEqual(['flag-a']);
    const all = await student('/api/me/tutor-notes?include_seen=1');
    expect(all.body.notes.find((n) => n.id === 'ev-student-j-1')?.seen_at).toBeTruthy();
    // Someone else cannot mark my note seen.
    await app(OTHER)('/api/me/recording-notes/flag-a/seen', { method: 'POST' });
    expect((await student('/api/me/tutor-notes')).body.notes.map((n) => n.id)).toEqual(['flag-a']);
  });

  it('rejects a malformed cursor and clamps the limit', async () => {
    expect((await app(STUDENT)('/api/me/tutor-notes?before=nope')).status).toBe(400);
    expect((await app(STUDENT)('/api/me/tutor-notes?include_seen=1&limit=0')).body.notes).toHaveLength(1);
    expect(parseTutorNotesCursor('2026-09-24 12:00:00|flag-a')).toEqual({ at: '2026-09-24 12:00:00', id: 'flag-a' });
    expect(parseTutorNotesCursor('2026-09-24T12:00:00Z|x')).toBeNull();
  });
});
