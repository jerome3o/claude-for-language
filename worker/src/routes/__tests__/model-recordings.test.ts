/**
 * The tutor's model recording on a needs-work mark (docs/RECORDING_REVIEW.md "Model recordings"):
 * PUT|DELETE /api/relationships/:relId/recordings/:eventId/mark/audio, the clip on the queue's mark,
 * on the student's unseen feed and the Tutor notes page, GET /api/recording-marks/:eventId/model-audio
 * for the two people of the mark only, and the clean-up (cleared mark, "listened", replaced).
 * Real SQLite with every migration; R2 is an in-memory map.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../../types';
import insights from '../insights';
import recordingNotes from '../recording-notes';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import { MODEL_RECORDING_PREFIX, modelAudioUrl, inspectModelRecording } from '../../services/model-recordings';

const TUTOR = 'tutor-mh';
const OTHER_TUTOR = 'tutor-other';
const STUDENT = 'student-j';
const STRANGER = 'stranger';
const EVENT = 'ev-1';

let db: SqliteD1;
let r2: Map<string, { bytes: Uint8Array; type?: string }>;

function exec(sql: string, ...params: Array<string | number | null>) {
  db.raw.run(sql, params);
}

const bucket = {
  async put(key: string, bytes: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) {
    r2.set(key, { bytes, type: opts?.httpMetadata?.contentType });
  },
  async get(key: string) {
    const o = r2.get(key);
    if (!o) return null;
    return { body: o.bytes, size: o.bytes.length, httpMetadata: { contentType: o.type }, httpEtag: '"e"' };
  },
  async delete(key: string) {
    r2.delete(key);
  },
};

function app(userId: string) {
  const a = new Hono<{ Bindings: Env }>();
  a.use('*', async (c, next) => {
    c.set('user', { id: userId } as never);
    await next();
  });
  a.route('/api', insights);
  a.route('/api', recordingNotes);
  const env = { DB: db, AUDIO_BUCKET: bucket } as unknown as Env;
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
  return (path: string, init?: RequestInit) => a.request(path, init, env, ctx);
}

/** A tiny WebM header (EBML magic) — enough for the sniffer. */
function webm(n = 64): Uint8Array {
  const b = new Uint8Array(n);
  b.set([0x1a, 0x45, 0xdf, 0xa3]);
  return b;
}

const markPath = `/api/relationships/rel-1/recordings/${EVENT}/mark`;

async function mark(user: string, status: 'needs_work' | 'listened', comment: string | null = null) {
  return app(user)(markPath, { method: 'PUT', body: JSON.stringify({ status, comment }), headers: { 'Content-Type': 'application/json' } });
}

async function upload(user: string, bytes: Uint8Array = webm(), query = '?duration_ms=1800') {
  return app(user)(`${markPath}/audio${query}`, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'audio/webm' } });
}

beforeEach(async () => {
  db = await createSqliteD1();
  r2 = new Map();
  for (const [id, email, name] of [
    [TUTOR, 'mh@example.com', '明慧老师'],
    [OTHER_TUTOR, 'ot@example.com', 'Other tutor'],
    [STUDENT, 'j@example.com', 'Jerome'],
    [STRANGER, 's@example.com', 'Stranger'],
  ]) {
    exec('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', id, email, name);
  }
  exec("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'student', 'active')", STUDENT, TUTOR);
  exec("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-2', ?, ?, 'student', 'active')", STUDENT, OTHER_TUTOR);
  exec("INSERT INTO decks (id, user_id, name) VALUES ('deck-1', ?, 'Lesson 8')", STUDENT);
  exec("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('note-1', 'deck-1', '银行', 'yínháng', 'bank')");
  exec("INSERT INTO cards (id, note_id, card_type) VALUES ('card-1', 'note-1', 'hanzi_to_meaning')");
  exec(
    "INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at, recording_url) VALUES (?, 'card-1', ?, 1, '2026-10-10T10:00:00Z', 'recordings/ev-1.webm')",
    EVENT, STUDENT
  );
});

describe('model recording on a needs-work mark', () => {
  it('needs a needs-work mark first', async () => {
    expect((await upload(TUTOR)).status).toBe(409);
    await mark(TUTOR, 'listened');
    expect((await upload(TUTOR)).status).toBe(409);
    expect(r2.size).toBe(0);
  });

  it('stores the clip under tutor-recordings/<rel>/ and puts its URL on the mark', async () => {
    await mark(TUTOR, 'needs_work', '银 is 2nd tone');
    const res = await upload(TUTOR);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mark: { model_audio_url: string | null; comment: string } };
    expect(body.mark.comment).toBe('银 is 2nd tone');
    expect(body.mark.model_audio_url).toMatch(/^\/api\/recording-marks\/ev-1\/model-audio\?v=[0-9a-f]{12}$/);
    const keys = [...r2.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0].startsWith(`${MODEL_RECORDING_PREFIX}rel-1/ev-1-`)).toBe(true);
    expect(keys[0].endsWith('.webm')).toBe(true);
    const row = db.raw.exec('SELECT model_audio_ms, model_audio_mime FROM tutor_recording_marks')[0].values[0];
    expect(row).toEqual([1800, 'audio/webm']);
  });

  it('refuses non-audio, empty and oversize bodies', async () => {
    await mark(TUTOR, 'needs_work');
    expect((await upload(TUTOR, new TextEncoder().encode('hello this is not audio'))).status).toBe(415);
    expect((await upload(TUTOR, new Uint8Array(0))).status).toBe(400);
    expect((await upload(TUTOR, webm(), '?duration_ms=600000')).status).toBe(400);
    expect(() => inspectModelRecording(webm(3 * 1024 * 1024))).toThrow(/too long/);
  });

  it('only the student’s tutor may record, and only on the student’s take', async () => {
    await mark(TUTOR, 'needs_work');
    expect((await upload(STUDENT)).status).toBe(403); // rel-1 from the student's side: not the tutor
    expect((await upload(STRANGER)).status).toBe(404);
    // The other tutor of the same student uses her own relationship id — rel-1 is not hers.
    const other = await app(OTHER_TUTOR)(`${markPath}/audio`, { method: 'PUT', body: webm() });
    expect(other.status).toBe(404);
    expect(r2.size).toBe(0);
  });

  it('a new clip replaces the old object and makes the note new again', async () => {
    await mark(TUTOR, 'needs_work', 'tone');
    await upload(TUTOR);
    const first = [...r2.keys()][0];
    exec("UPDATE tutor_recording_marks SET student_seen_at = datetime('now')");
    await upload(TUTOR);
    expect(r2.has(first)).toBe(false);
    expect(r2.size).toBe(1);
    const seen = db.raw.exec('SELECT student_seen_at FROM tutor_recording_marks')[0].values[0][0];
    expect(seen).toBeNull();
  });

  it('DELETE …/mark/audio, "listened" and clearing the mark all remove the object', async () => {
    await mark(TUTOR, 'needs_work', 'tone');
    await upload(TUTOR);
    const del = await app(TUTOR)(`${markPath}/audio`, { method: 'DELETE' });
    expect(((await del.json()) as { removed: boolean }).removed).toBe(true);
    expect(r2.size).toBe(0);

    await upload(TUTOR);
    expect(r2.size).toBe(1);
    await mark(TUTOR, 'listened');
    expect(r2.size).toBe(0);
    expect(db.raw.exec('SELECT model_audio_key FROM tutor_recording_marks')[0].values[0][0]).toBeNull();

    await mark(TUTOR, 'needs_work');
    await upload(TUTOR);
    expect(r2.size).toBe(1);
    await app(TUTOR)(markPath, { method: 'DELETE' });
    expect(r2.size).toBe(0);
  });
});

describe('the student side', () => {
  beforeEach(async () => {
    await mark(TUTOR, 'needs_work', null); // a recording with no words is still a note
    await upload(TUTOR);
  });

  it('the unseen feed carries the clip and my own take', async () => {
    const res = await app(STUDENT)('/api/me/recording-notes');
    const { notes } = (await res.json()) as { notes: Array<{ event_id: string; comment: string; model_audio_url: string; recording_url: string }> };
    expect(notes).toHaveLength(1);
    expect(notes[0].comment).toBe('');
    expect(notes[0].recording_url).toBe('recordings/ev-1.webm');
    expect(notes[0].model_audio_url).toMatch(/^\/api\/recording-marks\/ev-1\/model-audio\?v=/);
  });

  it('the Tutor notes page carries it too', async () => {
    const res = await app(STUDENT)('/api/me/tutor-notes?include_seen=1');
    const { notes } = (await res.json()) as { notes: Array<{ id: string; model_audio_url: string | null }> };
    expect(notes.map((n) => n.id)).toEqual([EVENT]);
    expect(notes[0].model_audio_url).toMatch(/model-audio\?v=/);
  });

  it('the queue shows it on the mark', async () => {
    const res = await app(TUTOR)('/api/relationships/rel-1/recordings/queue?view=all&from=2026-10-01');
    const body = (await res.json()) as { items: Array<{ event_id: string; mark: { model_audio_url: string | null } | null }> };
    expect(body.items[0].mark?.model_audio_url).toMatch(/model-audio\?v=/);
  });

  it('serves the bytes to the student and the tutor who made it — nobody else', async () => {
    for (const user of [STUDENT, TUTOR]) {
      const res = await app(user)(`/api/recording-marks/${EVENT}/model-audio`);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('audio/webm');
      expect(res.headers.get('Cache-Control')).toContain('private');
      expect(new Uint8Array(await res.arrayBuffer()).slice(0, 4)).toEqual(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]));
    }
    for (const user of [STRANGER, OTHER_TUTOR]) {
      expect((await app(user)(`/api/recording-marks/${EVENT}/model-audio`)).status).toBe(404);
    }
  });
});

describe('modelAudioUrl', () => {
  it('versions the URL by the clip id', () => {
    expect(modelAudioUrl('ev-1', 'tutor-recordings/rel-1/ev-1-abc123def456.webm')).toBe('/api/recording-marks/ev-1/model-audio?v=abc123def456');
    expect(modelAudioUrl('ev-1', null)).toBeNull();
  });
});
