/**
 * `ensureNoteClips` (POST /api/notes/:id/ensure-audio) against a real SQLite: a missing
 * clip is made, a present one is left alone, a reported 404 only counts when R2 agrees,
 * and a student's copy takes the tutor's clip before generating its own.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { ensureNoteClips, audioKeyOf } from '../content/audio';
import type { Env } from '../../types';
import type { TtsFn } from '../tts/clips';

const TUTOR = 'tutor-1';
const STUDENT = 'student-1';

function exec(db: SqliteD1, sql: string, ...params: unknown[]) {
  const stmt = db.raw.prepare(sql);
  stmt.run(params as never);
  stmt.free();
}

function seed(db: SqliteD1) {
  exec(db, "INSERT INTO users (id, email, name, role) VALUES (?, 'mh@example.com', 'MH', 'student')", TUTOR);
  exec(db, "INSERT INTO users (id, email, name, role) VALUES (?, 'j@example.com', 'J', 'student')", STUDENT);
  exec(db, "INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'student', 'active')", STUDENT, TUTOR);
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('t-deck', ?, 'Lesson 8')", TUTOR);
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('s-copy', ?, 'Lesson 8 (from tutor)')", STUDENT);
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('s-own', ?, 'Mine')", STUDENT);
  exec(db, "INSERT INTO shared_decks (id, relationship_id, source_deck_id, target_deck_id) VALUES ('share-1', 'rel-1', 't-deck', 's-copy')");
}

function note(db: SqliteD1, id: string, deck: string, hanzi: string, audio: string | null, clue: string | null, clueAudio: string | null) {
  exec(
    db,
    "INSERT INTO notes (id, deck_id, hanzi, pinyin, english, audio_url, sentence_clue, sentence_clue_audio_url) VALUES (?, ?, ?, 'p', 'e', ?, ?, ?)",
    id, deck, hanzi, audio, clue, clueAudio,
  );
}

function row(db: SqliteD1, id: string) {
  return db.rows<{ audio_url: string | null; sentence_clue_audio_url: string | null; audio_provider: string | null }>(
    'SELECT audio_url, sentence_clue_audio_url, audio_provider FROM notes WHERE id = ?', [id],
  )[0];
}

describe('ensureNoteClips', () => {
  let db: SqliteD1;
  let inBucket: Set<string>;
  let ttsCalls: Array<{ text: string; id: string }>;
  let ttsWorks: boolean;
  let env: Env;
  const tts: TtsFn = async (_env, text, id) => {
    ttsCalls.push({ text, id });
    if (!ttsWorks) return { ok: false, permanent: false, rateLimited: false, reason: 'network' };
    const key = `generated/${id}_new.mp3`;
    inBucket.add(key);
    return { ok: true, result: { audioKey: key, provider: 'minimax', model: 'speech-2.8-hd', voice: 'Chinese (Mandarin)_Radio_Host', speed: 0.6 } };
  };

  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
    inBucket = new Set();
    ttsCalls = [];
    ttsWorks = true;
    env = {
      DB: db,
      MINIMAX_API_KEY: 'k',
      AUDIO_BUCKET: {
        head: async (key: string) => (inBucket.has(key) ? { key } : null),
        delete: async (key: string) => { inBucket.delete(key); },
      } as unknown as R2Bucket,
    } as unknown as Env;
  });

  it('makes both clips when a note has none', async () => {
    note(db, 'n1', 's-own', '刮风', null, '今天刮风了。', null);
    const result = await ensureNoteClips(env, 'n1', {}, tts);
    expect(result).toEqual({ word: 'generated', sentence: 'generated' });
    expect(ttsCalls).toEqual([{ text: '刮风', id: 'n1' }, { text: '今天刮风了。', id: 'n1-sentence' }]);
    expect(row(db, 'n1')).toMatchObject({ audio_url: 'generated/n1_new.mp3', sentence_clue_audio_url: 'generated/n1-sentence_new.mp3' });
  });

  it('is idempotent: clips that are there are left alone, a note without a sentence says none', async () => {
    note(db, 'n1', 's-own', '刮风', 'generated/w.mp3', '今天刮风了。', 'generated/s.mp3');
    note(db, 'n2', 's-own', '下雨', 'generated/w2.mp3', null, null);
    expect(await ensureNoteClips(env, 'n1', {}, tts)).toEqual({ word: 'ok', sentence: 'ok' });
    expect(await ensureNoteClips(env, 'n2', {}, tts)).toEqual({ word: 'ok', sentence: 'none' });
    expect(ttsCalls).toEqual([]);
  });

  it('remakes a reported 404 only when R2 really has no such clip', async () => {
    note(db, 'n1', 's-own', '刮风', 'generated/gone.mp3', null, null);
    note(db, 'n2', 's-own', '下雨', 'generated/there.mp3', null, null);
    inBucket.add('generated/there.mp3');
    expect(await ensureNoteClips(env, 'n1', { broken: ['/api/audio/generated/gone.mp3'] }, tts)).toEqual({ word: 'generated', sentence: 'none' });
    // A flaky connection reported it, but the clip is fine: nothing is regenerated.
    expect(await ensureNoteClips(env, 'n2', { broken: ['generated/there.mp3'] }, tts)).toEqual({ word: 'ok', sentence: 'none' });
    expect(ttsCalls.map((c) => c.id)).toEqual(['n1']);
    expect(row(db, 'n2').audio_url).toBe('generated/there.mp3');
  });

  it("gives a student's copy the tutor's clips before generating its own", async () => {
    note(db, 't1', 't-deck', '刮风', 'generated/tutor.mp3', '今天刮风了。', 'generated/tutor-s.mp3');
    note(db, 's1', 's-copy', '刮风 ', null, '今天刮风了。', null);
    inBucket.add('generated/tutor.mp3');
    inBucket.add('generated/tutor-s.mp3');
    expect(await ensureNoteClips(env, 's1', {}, tts)).toEqual({ word: 'copied', sentence: 'copied' });
    expect(ttsCalls).toEqual([]);
    expect(row(db, 's1')).toMatchObject({ audio_url: 'generated/tutor.mp3', sentence_clue_audio_url: 'generated/tutor-s.mp3' });
  });

  it("makes the TUTOR's clip once when it is gone and shares it; a different sentence gets its own", async () => {
    note(db, 't1', 't-deck', '刮风', 'generated/tutor-gone.mp3', '风很大。', 'generated/tutor-s.mp3');
    note(db, 's1', 's-copy', '刮风', null, '今天刮风了。', null);
    inBucket.add('generated/tutor-s.mp3');
    expect(await ensureNoteClips(env, 's1', {}, tts)).toEqual({ word: 'copied', sentence: 'generated' });
    expect(ttsCalls.map((c) => c.id)).toEqual(['t1', 's1-sentence']);
    expect(row(db, 's1').audio_url).toBe('generated/t1_new.mp3');
    expect(row(db, 't1').audio_url).toBe('generated/t1_new.mp3');
  });

  it('queues the clip (interactive) when MiniMax is busy, instead of failing silently', async () => {
    const sent: unknown[] = [];
    env = { ...env, TTS_QUEUE: { send: async (body: unknown) => { sent.push(body); } } } as unknown as Env;
    const busy: TtsFn = async () => ({ ok: false, permanent: false, rateLimited: true, reason: 'base_resp 1002', retryAfterMs: 60_000 });
    note(db, 'n1', 's-own', '刮风', null, null, null);
    expect(await ensureNoteClips(env, 'n1', {}, busy)).toEqual({ word: 'queued', sentence: 'none' });
    expect(sent).toEqual([{ kind: 'clip', target: { kind: 'word', id: 'n1' }, priority: 'interactive', force: undefined, attempt: undefined }]);
  });

  it('reports failed (and writes nothing) when TTS is unavailable', async () => {
    ttsWorks = false;
    note(db, 'n1', 's-own', '刮风', null, '今天刮风了。', null);
    expect(await ensureNoteClips(env, 'n1', {}, tts)).toEqual({ word: 'failed', sentence: 'failed' });
    expect(row(db, 'n1')).toMatchObject({ audio_url: null, sentence_clue_audio_url: null });
  });

  it('audioKeyOf strips the serving prefix', () => {
    expect(audioKeyOf('/api/audio/generated/a.mp3')).toBe('generated/a.mp3');
    expect(audioKeyOf('api/audio/generated/a.mp3')).toBe('generated/a.mp3');
    expect(audioKeyOf('generated/a.mp3')).toBe('generated/a.mp3');
  });
});
