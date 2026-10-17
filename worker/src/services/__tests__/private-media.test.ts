/**
 * GET /api/audio/* is an allowlist (docs/AUDIO.md "Private media", shared/media/access.ts):
 * generated content is public, person-made media needs a credential AND the right person,
 * everything else is 404. Real SQLite (every migration) for the authorisation queries.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { mediaRoutes, mediaPathFor, serveAudio } from '../../routes/media';
import { canAccessMedia } from '../media-access';
import { createMediaToken, signMediaPath, verifyMediaSignature, verifyMediaToken, MEDIA_TOKEN_TTL_S } from '../media-signing';
import { mediaAccessOf, mediaKeyOf, PRIVATE_MEDIA_PREFIXES, PUBLIC_MEDIA_PREFIXES } from '@shared/media/access';
import { STORAGE_PREFIXES } from '../admin/storage-cleanup';
import type { Env, User } from '../../types';

const STUDENT = 'u-student';
const TUTOR = 'u-tutor';
const STRANGER = 'u-stranger';
const SECRET = 'test-secret';

function exec(db: SqliteD1, sql: string, ...params: unknown[]) {
  const stmt = db.raw.prepare(sql);
  stmt.run(params as never);
  stmt.free();
}

function fakeBucket(keys: string[]): R2Bucket {
  return {
    get: async (key: string) =>
      keys.includes(key)
        ? ({ body: new Blob([`bytes of ${key}`]).stream(), size: 9 + key.length, httpMetadata: { contentType: 'audio/webm' }, httpEtag: '"e"', range: undefined } as unknown as R2ObjectBody)
        : null,
  } as unknown as R2Bucket;
}

const KEYS = {
  take: 'recordings/ev-1.webm',
  noteRec: 'recordings/n-1/rec-1.webm',
  lesson: 'recordings/lessons/att-1/m1.webm',
  message: 'recordings/messages/msg-1.webm',
  call: 'calls/call-1/piece-1.webm',
  upload: 'note-uploads/n-1-x.jpg',
  lessonNote: 'lesson-notes/ln-1/abc-notes.pdf',
  clip: 'generated/n-1_a.mp3',
  chat: 'chat-media/conv-1/msg-2.jpg',
  debug: 'debug/u-student/r1.json',
  material: 'materials/u-tutor/m1/p1.jpg',
  hunt: 'picture-hunts/h1.jpg',
  podcast: 'podcast-episodes/e1.mp3',
};

async function seed(): Promise<SqliteD1> {
  const db = await createSqliteD1();
  for (const id of [STUDENT, TUTOR, STRANGER]) exec(db, 'INSERT INTO users (id, email, name) VALUES (?, ?, ?)', id, `${id}@example.com`, id);
  exec(db, "INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'student', 'active')", STUDENT, TUTOR);
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('d-1', ?, 'Deck')", STUDENT);
  exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english, image_key) VALUES ('n-1', 'd-1', '银行', 'yínháng', 'bank', ?)", KEYS.upload);
  exec(db, "INSERT INTO cards (id, note_id, card_type) VALUES ('c-1', 'n-1', 'hanzi_to_meaning')");
  exec(db, "INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at, recording_url) VALUES ('ev-1', 'c-1', ?, 2, '2026-10-01T10:00:00Z', ?)", STUDENT, KEYS.take);
  exec(db, "INSERT INTO note_audio_recordings (id, note_id, audio_url, provider, created_by) VALUES ('rec-1', 'n-1', ?, 'user', ?)", KEYS.noteRec, STUDENT);
  exec(db, "INSERT INTO custom_lessons (id, user_id, title, spec) VALUES ('l-1', ?, 'L', '{}')", STUDENT);
  exec(db, "INSERT INTO custom_lesson_attempts (id, user_id, lesson_id, completed_at, spec, data) VALUES ('att-1', ?, 'l-1', '2026-10-01', '{}', '{}')", STUDENT);
  exec(db, "INSERT INTO custom_lesson_attempt_media (attempt_id, media_key, user_id, audio_key) VALUES ('att-1', 'm1', ?, ?)", STUDENT, KEYS.lesson);
  exec(db, "INSERT INTO conversations (id, relationship_id) VALUES ('conv-1', 'rel-1')");
  exec(db, "INSERT INTO messages (id, conversation_id, sender_id, content, recording_url) VALUES ('msg-1', 'conv-1', ?, '', ?)", STUDENT, KEYS.message);
  exec(db, "INSERT INTO calls (id, relationship_id, created_by) VALUES ('call-1', 'rel-1', ?)", TUTOR);
  exec(db, "INSERT INTO lesson_notes (id, user_id, raw_text) VALUES ('ln-1', ?, 'notes')", TUTOR);
  exec(db, "INSERT INTO lesson_note_files (id, lesson_note_id, r2_key, filename) VALUES ('f-1', 'ln-1', ?, 'notes.pdf')", KEYS.lessonNote);
  exec(db, "INSERT INTO auth_sessions (id, user_id, expires_at) VALUES ('sess-tutor', ?, '2099-01-01T00:00:00Z')", TUTOR);
  exec(db, "INSERT INTO auth_sessions (id, user_id, expires_at) VALUES ('sess-stranger', ?, '2099-01-01T00:00:00Z')", STRANGER);
  return db;
}

function appFor(db: SqliteD1, signedIn: string | null = null) {
  const env = { DB: db, AUDIO_BUCKET: fakeBucket(Object.values(KEYS)), SESSION_SECRET: SECRET } as unknown as Env;
  const app = new Hono<{ Bindings: Env }>();
  app.get('/api/audio/*', serveAudio);
  app.use('/api/media/*', async (c, next) => {
    if (!signedIn) return c.json({ error: 'Unauthorized' }, 401);
    c.set('user', { id: signedIn } as User);
    await next();
  });
  app.route('/api', mediaRoutes);
  const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers }, env);
  return { app, env, get };
}

describe('the allowlist', () => {
  it('classifies every registered prefix on purpose', () => {
    for (const p of STORAGE_PREFIXES) {
      const access = mediaAccessOf(`${p.prefix}x`);
      // Generated content may be public; nothing a person made is ever public.
      if (!p.collectable && !p.prefix.startsWith('avatars/')) expect(access, p.prefix).not.toBe('public');
    }
    expect(PUBLIC_MEDIA_PREFIXES.every((p) => STORAGE_PREFIXES.some((s) => s.prefix === p))).toBe(true);
    expect(PRIVATE_MEDIA_PREFIXES.every((p) => STORAGE_PREFIXES.some((s) => s.prefix === p))).toBe(true);
  });

  it('reads keys from links and refuses odd paths', () => {
    expect(mediaKeyOf('https://api.example/api/audio/recordings/x.webm?mt=1')).toBe('recordings/x.webm');
    expect(mediaKeyOf('/api/audio/generated/a.mp3')).toBe('generated/a.mp3');
    expect(mediaAccessOf('generated/a.mp3')).toBe('public');
    expect(mediaAccessOf('recordings/lessons/a/b.webm')).toBe('private');
    expect(mediaAccessOf('chat-media/c/m.jpg')).toBe('none');
    expect(mediaAccessOf('tts-cache/x.mp3')).toBe('none');
    expect(mediaAccessOf('generated/../recordings/x.webm')).toBe('none');
    expect(mediaAccessOf('somethingelse.mp3')).toBe('none');
  });
});

describe('GET /api/audio/*', () => {
  let db: SqliteD1;
  beforeEach(async () => { db = await seed(); });

  it('serves generated clips to anyone, cached for a year', async () => {
    const res = await appFor(db).get(`/api/audio/${KEYS.clip}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('never serves chat media, debug reports, materials, picture hunts or podcast copies here', async () => {
    const { get } = appFor(db);
    for (const key of [KEYS.chat, KEYS.debug, KEYS.material, KEYS.hunt, KEYS.podcast]) {
      expect((await get(`/api/audio/${key}`, { Authorization: 'Bearer sess-tutor' })).status, key).toBe(404);
    }
  });

  it('refuses person-made media without a credential (old clients: 401)', async () => {
    const { get } = appFor(db);
    for (const key of [KEYS.take, KEYS.lesson, KEYS.call, KEYS.upload]) expect((await get(`/api/audio/${key}`)).status, key).toBe(401);
  });

  it('lets the tutor play her student’s recording with her session; a stranger gets 404', async () => {
    const { get } = appFor(db);
    const ok = await get(`/api/audio/${KEYS.take}`, { Authorization: 'Bearer sess-tutor' });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('private, max-age=3600');
    expect(ok.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect((await get(`/api/audio/${KEYS.take}`, { Authorization: 'Bearer sess-stranger' })).status).toBe(404);
    expect((await get(`/api/audio/${KEYS.take}`, { Authorization: 'Bearer no-such-session' })).status).toBe(401);
    // A cookie is not a credential here.
    expect((await get(`/api/audio/${KEYS.take}`, { Cookie: 'session=sess-tutor' })).status).toBe(401);
  });

  it('accepts a media token, for its user only', async () => {
    const { get, env } = appFor(db);
    const tutor = await createMediaToken(env, TUTOR);
    const stranger = await createMediaToken(env, STRANGER);
    expect((await get(`/api/audio/${KEYS.lesson}?mt=${encodeURIComponent(tutor.token)}`)).status).toBe(200);
    expect((await get(`/api/audio/${KEYS.lesson}?mt=${encodeURIComponent(stranger.token)}`)).status).toBe(404);
    expect((await get(`/api/audio/${KEYS.lesson}?mt=garbage`)).status).toBe(401);
  });

  it('serves a signed link for exactly its key until it expires', async () => {
    const { get, env } = appFor(db);
    const path = await signMediaPath(env, KEYS.call, 600);
    expect((await get(path)).status).toBe(200);
    // Same signature on another key, a changed expiry, a changed signature: refused.
    expect((await get(path.replace(KEYS.call, KEYS.take))).status).toBe(403);
    const exp = Number(new URL(path, 'https://x').searchParams.get('exp'));
    expect((await get(path.replace(`exp=${exp}`, `exp=${exp + 1}`))).status).toBe(403);
    expect((await get(path.replace(/sig=.{4}/, 'sig=AAAA'))).status).toBe(403);
    const old = await signMediaPath(env, KEYS.call, 600, Date.now() - 3600_000);
    expect((await get(old)).status).toBe(403);
  });
});

describe('who may see what', () => {
  let db: SqliteD1;
  beforeEach(async () => { db = await seed(); });

  it('owner and their tutor; never a stranger', async () => {
    for (const key of [KEYS.take, KEYS.noteRec, KEYS.lesson, KEYS.upload]) {
      expect(await canAccessMedia(db, STUDENT, key), key).toBe(true);
      expect(await canAccessMedia(db, TUTOR, key), key).toBe(true);
      expect(await canAccessMedia(db, STRANGER, key), key).toBe(false);
    }
  });

  it('a student does not hear their tutor’s recordings (only a tutor of the owner)', async () => {
    exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('d-t', ?, 'Hers')", TUTOR);
    exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n-t', 'd-t', '好', 'hǎo', 'good')");
    exec(db, "INSERT INTO cards (id, note_id, card_type) VALUES ('c-t', 'n-t', 'hanzi_to_meaning')");
    exec(db, "INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at, recording_url) VALUES ('ev-t', 'c-t', ?, 2, '2026-10-01', 'recordings/ev-t.webm')", TUTOR);
    expect(await canAccessMedia(db, TUTOR, 'recordings/ev-t.webm')).toBe(true);
    expect(await canAccessMedia(db, STUDENT, 'recordings/ev-t.webm')).toBe(false);
  });

  it('a removed relationship no longer opens the student’s recordings', async () => {
    exec(db, "UPDATE tutor_relationships SET status = 'removed' WHERE id = 'rel-1'");
    expect(await canAccessMedia(db, TUTOR, KEYS.take)).toBe(false);
    expect(await canAccessMedia(db, STUDENT, KEYS.take)).toBe(true);
  });

  it('call audio: both members; chat voice: both people; lesson-note files: the owner', async () => {
    expect(await canAccessMedia(db, STUDENT, KEYS.call)).toBe(true);
    expect(await canAccessMedia(db, TUTOR, KEYS.call)).toBe(true);
    expect(await canAccessMedia(db, STRANGER, KEYS.call)).toBe(false);
    expect(await canAccessMedia(db, TUTOR, KEYS.message)).toBe(true);
    expect(await canAccessMedia(db, STRANGER, KEYS.message)).toBe(false);
    expect(await canAccessMedia(db, TUTOR, KEYS.lessonNote)).toBe(true);
    expect(await canAccessMedia(db, STUDENT, KEYS.lessonNote)).toBe(false);
  });

  it('a key nothing refers to opens for nobody', async () => {
    expect(await canAccessMedia(db, STUDENT, 'recordings/nobody.webm')).toBe(false);
    expect(await canAccessMedia(db, STUDENT, 'calls/no-call/p.webm')).toBe(false);
  });
});

describe('POST /api/media/sign and GET /api/media/token', () => {
  let db: SqliteD1;
  beforeEach(async () => { db = await seed(); });

  it('signs only what the caller may see', async () => {
    const { app, env } = appFor(db, TUTOR);
    const res = await app.request('/api/media/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: [KEYS.take, KEYS.clip, KEYS.chat, 'recordings/nobody.webm'], ttl_s: 86400 }),
    }, env);
    const body = await res.json() as { urls: Record<string, string | null> };
    expect(body.urls[KEYS.take]).toMatch(/^\/api\/audio\/recordings\/ev-1\.webm\?exp=\d+&sig=/);
    expect(body.urls[KEYS.clip]).toBe(`/api/audio/${KEYS.clip}`);
    expect(body.urls[KEYS.chat]).toBeNull();
    expect(body.urls['recordings/nobody.webm']).toBeNull();
    // The signed link plays without any other credential.
    expect((await appFor(db).get(body.urls[KEYS.take]!)).status).toBe(200);
  });

  it('a stranger gets no signature', async () => {
    const { app, env } = appFor(db, STRANGER);
    const res = await app.request('/api/media/sign', { method: 'POST', body: JSON.stringify({ keys: [KEYS.take] }) }, env);
    expect(((await res.json()) as { urls: Record<string, string | null> }).urls[KEYS.take]).toBeNull();
  });

  it('mints a 3-day media token for the signed-in user', async () => {
    const { app, env } = appFor(db, STUDENT);
    const res = await app.request('/api/media/token', {}, env);
    const { token, expires_at } = await res.json() as { token: string; expires_at: string };
    expect(await verifyMediaToken(env, token)).toBe(STUDENT);
    expect(Date.parse(expires_at) - Date.now()).toBeGreaterThan((MEDIA_TOKEN_TTL_S - 60) * 1000);
    expect(await verifyMediaToken(env, token, Date.now() + (MEDIA_TOKEN_TTL_S + 1) * 1000)).toBeNull();
    expect(await verifyMediaToken(env, token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toBeNull();
    expect(await verifyMediaToken({ SESSION_SECRET: 'other' }, token)).toBeNull();
  });

  it('responses hand authorised callers signed paths for private keys, plain ones for public', async () => {
    const env = { SESSION_SECRET: SECRET } as unknown as Env;
    const signed = await mediaPathFor(env, KEYS.call);
    const url = new URL(signed!, 'https://x');
    expect(await verifyMediaSignature(env, KEYS.call, url.searchParams.get('exp'), url.searchParams.get('sig'))).toBe(true);
    expect(await mediaPathFor(env, KEYS.clip)).toBe(`/api/audio/${KEYS.clip}`);
    expect(await mediaPathFor(env, null)).toBeNull();
  });
});
