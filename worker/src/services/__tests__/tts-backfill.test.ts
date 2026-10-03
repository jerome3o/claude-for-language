/**
 * The audio backfill against a real SQLite with every migration
 * (docs/AUDIO.md): the selector's priority order, provenance + the key swap
 * that never deletes a clip a student's copy still uses, idempotency, no
 * Google fallback, and the queue's delayed requeue on a rate limit.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { selectBackfill, backfillCounts, throughputPerMinute, etaMinutes } from '../tts/backfill';
import { ensureClip, type TtsFn } from '../tts/clips';
import { clipSignature, ttsSettings } from '../tts/settings';
import { handleClipMessage, runPumpTick } from '../tts/queue';
import type { Env } from '../../types';

const SETTINGS = ttsSettings();
const NOW = Date.parse('2026-10-03T12:00:00Z');

function exec(db: SqliteD1, sql: string, ...params: unknown[]) {
  const stmt = db.raw.prepare(sql);
  stmt.run(params as never);
  stmt.free();
}

function seed(db: SqliteD1) {
  exec(db, "INSERT INTO users (id, email, name, role, last_opened_at) VALUES ('jerome', 'jerome@example.com', 'J', 'student', ?)", new Date(NOW - 3600_000).toISOString());
  exec(db, "INSERT INTO users (id, email, name, role) VALUES ('tutor', 'mh@example.com', 'MH', 'tutor')");
  exec(db, "INSERT INTO users (id, email, name, role, last_opened_at) VALUES ('idle', 'idle@example.com', 'I', 'student', '2026-01-01T00:00:00Z')");
  exec(db, "INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel', 'jerome', 'tutor', 'student', 'active')");
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('j-own', 'jerome', 'Mine')");
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('t-deck', 'tutor', 'Lesson 8')");
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('j-copy', 'jerome', 'Lesson 8 (from tutor)')");
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('idle-deck', 'idle', 'Old')");
  exec(db, "INSERT INTO shared_decks (id, relationship_id, source_deck_id, target_deck_id) VALUES ('share', 'rel', 't-deck', 'j-copy')");
}

interface NoteOpts {
  audio?: string | null;
  provider?: string | null;
  settings?: string | null;
  clue?: string | null;
  clueAudio?: string | null;
  updated?: string;
}

function note(db: SqliteD1, id: string, deck: string, hanzi: string, o: NoteOpts = {}) {
  exec(
    db,
    `INSERT INTO notes (id, deck_id, hanzi, pinyin, english, audio_url, audio_provider, audio_settings, sentence_clue, sentence_clue_audio_url, updated_at)
     VALUES (?, ?, ?, 'p', 'e', ?, ?, ?, ?, ?, ?)`,
    id, deck, hanzi, o.audio ?? null, o.provider ?? null, o.settings ?? null, o.clue ?? null, o.clueAudio ?? null, o.updated ?? '2026-10-01 00:00:00',
  );
}

function card(db: SqliteD1, id: string, noteId: string, due: string | null, queue = 2) {
  exec(db, "INSERT INTO cards (id, note_id, card_type, queue, next_review_at) VALUES (?, ?, 'hanzi_to_meaning', ?, ?)", id, noteId, queue, due);
}

const current = (text: string) => clipSignature(SETTINGS, text);

describe('selectBackfill', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
  });

  it('due soon → active accounts → other missing → Google → old voice; word before sentence before set', async () => {
    note(db, 'idle-missing', 'idle-deck', '旧');
    note(db, 'due-missing', 'idle-deck', '快', { clue: '快点儿。' });
    card(db, 'c1', 'due-missing', new Date(NOW + 3600_000).toISOString());
    note(db, 'later-missing', 'idle-deck', '慢');
    card(db, 'c2', 'later-missing', new Date(NOW + 5 * 86_400_000).toISOString());
    note(db, 'jerome-missing', 'j-own', '我', { clue: '我在这儿。', clueAudio: null });
    note(db, 'google', 'idle-deck', '谷', { audio: 'generated/g.mp3', provider: 'gtts' });
    note(db, 'old-voice', 'idle-deck', '老', { audio: 'generated/o.mp3', provider: 'minimax', settings: null });
    note(db, 'other-settings', 'idle-deck', '别', { audio: 'generated/x.mp3', provider: 'minimax', settings: 'sdeadbeef.12345678' });
    note(db, 'current', 'idle-deck', '好', { audio: 'generated/c.mp3', provider: 'minimax', settings: current('好') });
    exec(db, "INSERT INTO note_sentences (id, note_id, position, hanzi) VALUES ('sent-1', 'idle-missing', 0, '这是旧的。')");

    const items = await selectBackfill(db, { now: NOW, limit: 50, userIds: ['jerome'], settingsHash: SETTINGS.hash });
    expect(items.map((i) => `${i.tier}:${i.kind}:${i.id}`)).toEqual([
      'due_soon:word:due-missing',
      'due_soon:clue:due-missing',
      'active_users:word:jerome-missing',
      'active_users:clue:jerome-missing',
      // same updated_at → by id
      'missing:word:idle-missing',
      'missing:word:later-missing',
      'missing:sentence:sent-1',
      'google:word:google',
      'old_voice:word:old-voice',
      'old_voice:word:other-settings',
    ]);
    // the current clip is never picked
    expect(items.some((i) => i.id === 'current')).toBe(false);
  });

  it('respects the limit and skips clips waiting out a failure', async () => {
    note(db, 'a', 'idle-deck', '一');
    note(db, 'b', 'idle-deck', '二');
    note(db, 'c', 'idle-deck', '三');
    exec(db, "INSERT INTO tts_clip_failures (kind, target_id, attempts, next_attempt_at) VALUES ('word', 'b', 1, ?)", new Date(NOW + 600_000).toISOString());
    exec(db, "INSERT INTO tts_clip_failures (kind, target_id, attempts, next_attempt_at) VALUES ('word', 'c', 1, ?)", new Date(NOW - 1).toISOString());
    const items = await selectBackfill(db, { now: NOW, limit: 5, userIds: [], settingsHash: SETTINGS.hash });
    expect(items.map((i) => i.id).sort()).toEqual(['a', 'c']);
    expect(await selectBackfill(db, { now: NOW, limit: 1, userIds: [], settingsHash: SETTINGS.hash })).toHaveLength(1);
  });

  it('counts the backlog by state and by voice; ETA from measured throughput', async () => {
    note(db, 'm', 'idle-deck', '一');
    note(db, 'g', 'idle-deck', '二', { audio: 'generated/g.mp3', provider: 'gtts' });
    note(db, 'o', 'idle-deck', '三', { audio: 'generated/o.mp3', provider: 'minimax' });
    note(db, 'c', 'idle-deck', '四', { audio: 'generated/c.mp3', provider: 'minimax', settings: current('四') });
    const counts = await backfillCounts(db, { now: NOW, settingsHash: SETTINGS.hash });
    expect(counts.kinds.word).toMatchObject({ total: 4, missing: 1, google: 1, old_voice: 1, current: 1 });
    expect(counts.backlog).toBe(3);
    expect(counts.by_voice.filter((v) => v.kind === 'word').reduce((n, v) => n + v.count, 0)).toBe(3);

    const minute = Math.floor(NOW / 60_000);
    const minutes = Array.from({ length: 10 }, (_, i) => ({ minute: minute - 10 + i, ok: 30 }));
    expect(throughputPerMinute(minutes, NOW, 33)).toEqual({ per_minute: 30, measured: true, window_minutes: 10 });
    expect(throughputPerMinute([], NOW, 33)).toMatchObject({ per_minute: 33, measured: false });
    expect(etaMinutes(300, 30)).toBe(10);
    expect(etaMinutes(0, 0)).toBe(0);
  });
});

describe('ensureClip: provenance, key swap, shared clips', () => {
  let db: SqliteD1;
  let bucket: Set<string>;
  let ttsCalls: string[];
  let env: Env;
  let n = 0;
  const tts: TtsFn = async (_env, text, keyId) => {
    ttsCalls.push(text);
    const key = `generated/${keyId}_v${++n}.mp3`;
    bucket.add(key);
    return { ok: true, result: { audioKey: key, provider: 'minimax', model: SETTINGS.model, voice: SETTINGS.voice, speed: SETTINGS.speed } };
  };
  const row = (id: string) =>
    db.rows<{ audio_url: string | null; audio_provider: string | null; audio_model: string | null; audio_voice: string | null; audio_settings: string | null; updated_at: string }>(
      'SELECT audio_url, audio_provider, audio_model, audio_voice, audio_settings, updated_at FROM notes WHERE id = ?', [id],
    )[0];

  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
    bucket = new Set();
    ttsCalls = [];
    n = 0;
    env = {
      DB: db,
      MINIMAX_API_KEY: 'k',
      AUDIO_BUCKET: {
        head: async (k: string) => (bucket.has(k) ? { key: k } : null),
        delete: async (k: string) => void bucket.delete(k),
      },
    } as unknown as Env;
  });

  it('replaces an old-voice clip: new key, provenance written, updated_at bumped, old object deleted', async () => {
    note(db, 'n1', 'j-own', '你好', { audio: 'generated/old.mp3', provider: 'minimax', updated: '2020-01-01 00:00:00' });
    bucket.add('generated/old.mp3');
    expect(await ensureClip(env, { kind: 'word', id: 'n1' }, { priority: 'batch', tts })).toEqual({ status: 'generated' });
    const r = row('n1');
    expect(r.audio_url).toBe('generated/n1_v1.mp3');
    expect(r).toMatchObject({ audio_provider: 'minimax', audio_model: 'speech-2.8-hd', audio_voice: 'Chinese (Mandarin)_Radio_Host', audio_settings: current('你好') });
    expect(r.updated_at > '2020-01-01 00:00:00').toBe(true);
    expect(bucket.has('generated/old.mp3')).toBe(false);
  });

  it('is idempotent: a current clip is left alone; a changed text is stale again', async () => {
    note(db, 'n1', 'j-own', '你好');
    await ensureClip(env, { kind: 'word', id: 'n1' }, { priority: 'batch', tts });
    expect(await ensureClip(env, { kind: 'word', id: 'n1' }, { priority: 'batch', tts })).toEqual({ status: 'current' });
    expect(ttsCalls).toEqual(['你好']);
    exec(db, "UPDATE notes SET hanzi = '您好' WHERE id = 'n1'");
    expect(await ensureClip(env, { kind: 'word', id: 'n1' }, { priority: 'batch', tts })).toEqual({ status: 'generated' });
    expect(ttsCalls).toEqual(['你好', '您好']);
  });

  it("the tutor's clip is made once and the student's copy moves with it; the old shared object is deleted only after both moved", async () => {
    note(db, 't1', 't-deck', '刮风', { audio: 'generated/shared.mp3', provider: 'gtts' });
    note(db, 's1', 'j-copy', '刮风', { audio: 'generated/shared.mp3', provider: 'gtts' });
    bucket.add('generated/shared.mp3');
    // The backfill happens to pick the student's copy first.
    expect(await ensureClip(env, { kind: 'word', id: 's1' }, { priority: 'batch', tts })).toEqual({ status: 'copied' });
    expect(ttsCalls).toEqual(['刮风']);
    expect(row('t1').audio_url).toBe('generated/t1_v1.mp3');
    expect(row('s1').audio_url).toBe('generated/t1_v1.mp3');
    expect(row('s1').audio_settings).toBe(current('刮风'));
    expect(bucket.has('generated/shared.mp3')).toBe(false);
    // Nothing left to do for either.
    expect(await ensureClip(env, { kind: 'word', id: 't1' }, { priority: 'batch', tts })).toEqual({ status: 'current' });
  });

  it('never deletes an old clip another row still references', async () => {
    note(db, 'a', 'j-own', '风', { audio: 'generated/x.mp3' });
    // An unrelated row (e.g. a sentence row) happens to point at the same object.
    note(db, 'b', 'idle-deck', '雨', { clue: '风大。', clueAudio: 'generated/x.mp3' });
    bucket.add('generated/x.mp3');
    exec(db, "UPDATE notes SET sentence_clue_audio_url = 'generated/keep.mp3' WHERE id = 'b'");
    exec(db, "INSERT INTO note_sentences (id, note_id, position, hanzi, audio_url) VALUES ('s', 'b', 0, '风。', 'generated/x.mp3')");
    await ensureClip(env, { kind: 'word', id: 'a' }, { priority: 'batch', tts });
    // The sentence row moved along with it (same object = same clip) …
    expect(db.rows<{ audio_url: string }>("SELECT audio_url FROM note_sentences WHERE id = 's'")[0].audio_url).toBe('generated/a_v1.mp3');
    // … so only now is the old object unreferenced and gone.
    expect(bucket.has('generated/x.mp3')).toBe(false);
  });

  it('a row that changed while generating keeps its new clip; ours is dropped', async () => {
    note(db, 'n1', 'j-own', '你好', { audio: 'generated/old.mp3' });
    bucket.add('generated/old.mp3');
    const racing: TtsFn = async (e, text, keyId, o) => {
      exec(db, "UPDATE notes SET audio_url = 'generated/theirs.mp3' WHERE id = 'n1'");
      bucket.add('generated/theirs.mp3');
      return tts(e, text, keyId, o);
    };
    expect(await ensureClip(env, { kind: 'word', id: 'n1' }, { priority: 'batch', tts: racing })).toEqual({ status: 'current' });
    expect(row('n1').audio_url).toBe('generated/theirs.mp3');
    expect(bucket.has('generated/n1_v1.mp3')).toBe(false);
  });

  it('no Google fallback: a failure stores nothing and waits out its retry time', async () => {
    note(db, 'n1', 'j-own', '你好');
    const failing: TtsFn = async () => ({ ok: false, permanent: false, rateLimited: false, reason: 'http 500' });
    expect(await ensureClip(env, { kind: 'word', id: 'n1' }, { priority: 'batch', tts: failing })).toMatchObject({ status: 'failed' });
    expect(row('n1').audio_url).toBeNull();
    expect(db.rows('SELECT kind, target_id, attempts FROM tts_clip_failures')).toEqual([{ kind: 'word', target_id: 'n1', attempts: 1 }]);
    expect(await selectBackfill(db, { now: Date.now(), limit: 5, userIds: [], settingsHash: SETTINGS.hash })).toEqual([]);
    // A later success clears it.
    await ensureClip(env, { kind: 'word', id: 'n1' }, { priority: 'batch', tts });
    expect(db.rows('SELECT * FROM tts_clip_failures')).toEqual([]);
  });

  it('a sentence-set row: ISO updated_at bumped, provenance written', async () => {
    note(db, 'n1', 'j-own', '风');
    exec(db, "INSERT INTO note_sentences (id, note_id, position, hanzi, updated_at) VALUES ('s1', 'n1', 0, '风很大。', '2020-01-01T00:00:00.000Z')");
    expect(await ensureClip(env, { kind: 'sentence', id: 's1' }, { priority: 'batch', tts })).toEqual({ status: 'generated' });
    const s = db.rows<{ audio_url: string; audio_settings: string; updated_at: string }>("SELECT audio_url, audio_settings, updated_at FROM note_sentences WHERE id = 's1'")[0];
    expect(s.audio_url).toBe('generated/s1-sentence_v1.mp3');
    expect(s.audio_settings).toBe(current('风很大。'));
    expect(s.updated_at.startsWith('20') && s.updated_at.includes('T') && s.updated_at > '2020-01-01T00:00:00.000Z').toBe(true);
  });
});

describe('tts-queue', () => {
  let db: SqliteD1;
  let sent: Array<{ body: unknown; opts?: { delaySeconds?: number } }>;
  let env: Env;

  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
    sent = [];
    env = {
      DB: db,
      MINIMAX_API_KEY: 'k',
      TTS_QUEUE: { send: async (body: unknown, opts?: { delaySeconds?: number }) => void sent.push({ body, opts }) },
      AUDIO_BUCKET: { head: async () => null, delete: async () => {}, put: async () => {} },
    } as unknown as Env;
  });

  it('a clip MiniMax rate-limits (1002) is requeued 60 s later, not retried in the delivery', async () => {
    note(db, 'n1', 'j-own', '你好');
    let calls = 0;
    const limited: TtsFn = async () => {
      calls++;
      return { ok: false, permanent: false, rateLimited: true, reason: 'base_resp 1002 rate limit exceeded(RPM)', retryAfterMs: 60_000 };
    };
    const result = await handleClipMessage(env, { kind: 'clip', target: { kind: 'word', id: 'n1' }, priority: 'batch' }, limited);
    expect(result.status).toBe('rate_limited');
    expect(calls).toBe(1);
    expect(sent).toEqual([{ body: { kind: 'clip', target: { kind: 'word', id: 'n1' }, priority: 'batch', force: undefined, attempt: 1 }, opts: { delaySeconds: 60 } }]);
    // and it is not recorded as a failure
    expect(db.rows('SELECT * FROM tts_clip_failures')).toEqual([]);
  });

  it('our own limiter saying "wait" requeues after the wait', async () => {
    note(db, 'n1', 'j-own', '你好');
    const wait: TtsFn = async () => ({ ok: false, permanent: false, rateLimited: true, reason: 'limiter', retryAfterMs: 3_200 });
    await handleClipMessage(env, { kind: 'clip', target: { kind: 'word', id: 'n1' }, priority: 'interactive', attempt: 2 }, wait);
    expect(sent[0]).toMatchObject({ body: { priority: 'interactive', attempt: 3 }, opts: { delaySeconds: 4 } });
  });

  it('the pump works the backlog in order, then sends itself again; stops when nothing is left', async () => {
    note(db, 'a', 'j-own', '一');
    note(db, 'b', 'idle-deck', '二');
    const made: string[] = [];
    const tts: TtsFn = async (_e, text, keyId) => {
      made.push(text);
      return { ok: true, result: { audioKey: `generated/${keyId}.mp3`, provider: 'minimax', model: SETTINGS.model, voice: SETTINGS.voice, speed: SETTINGS.speed } };
    };
    const tick = await runPumpTick(env, { kind: 'pump', token: 't' }, tts);
    expect(tick).toMatchObject({ picked: 2, made: 2, next: 'again' });
    expect(made.sort()).toEqual(['一', '二']);
    expect(sent).toMatchObject([{ body: { kind: 'pump', token: 't' } }]);
    const done = await runPumpTick(env, { kind: 'pump', token: 't' }, tts);
    expect(done.next).toBe('done');
    expect(sent).toHaveLength(1);
  });

  it('the pump backs off 60 s when MiniMax says rate limit', async () => {
    note(db, 'a', 'j-own', '一');
    const limited: TtsFn = async () => ({ ok: false, permanent: false, rateLimited: true, reason: 'base_resp 1002', retryAfterMs: 60_000 });
    const tick = await runPumpTick(env, { kind: 'pump', token: 't' }, limited);
    expect(tick).toMatchObject({ rateLimited: true, next: 'later', delaySeconds: 60 });
    expect(sent).toMatchObject([{ body: { kind: 'pump' }, opts: { delaySeconds: 60 } }]);
  });
});
