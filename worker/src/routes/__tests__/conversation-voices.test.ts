import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_CONVERSATION_VOICE_IDS } from '@shared/lesson';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import conversationVoices from '../conversation-voices';
import { voiceSampleKey } from '../../services/conversation-voices';
import type { Env } from '../../types';

const F = 'Chinese (Mandarin)_News_Anchor';
const F2 = 'presenter_female';
const M = 'Chinese (Mandarin)_Male_Announcer';
const M2 = 'presenter_male';

function fakeBucket() {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    get: vi.fn(async (key: string) => {
      const bytes = store.get(key);
      return bytes ? { arrayBuffer: async () => bytes.buffer } : null;
    }),
    put: vi.fn(async (key: string, bytes: Uint8Array) => { store.set(key, bytes); }),
  };
}

function makeApp(db: SqliteD1, user: { id: string; is_admin?: number } | null, bucket = fakeBucket()) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    if (user) c.set('user', user as never);
    await next();
  });
  app.route('/api', conversationVoices);
  const env = { DB: db, AUDIO_BUCKET: bucket, MINIMAX_API_KEY: 'mm-key' } as unknown as Env;
  return {
    bucket,
    get: (path: string) => app.request(path, undefined, env),
    put: (body: unknown) => app.request('/api/conversation-voices', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, env),
  };
}

describe('conversation voices routes', () => {
  let db: SqliteD1;

  beforeEach(async () => {
    db = await createSqliteD1();
    for (const [id, admin] of [['admin', 1], ['learner', 0], ['tutor', 0]] as const) {
      db.raw.run('INSERT INTO users (id, email, name, role, is_admin) VALUES (?, ?, ?, ?, ?)', [id, `${id}@x.test`, id, 'student', admin]);
    }
  });
  afterEach(() => vi.unstubAllGlobals());

  it('refuses a signed-out caller', async () => {
    const app = makeApp(db, null);
    expect((await app.get('/api/conversation-voices')).status).toBe(401);
    expect((await app.put({ enabled: [F, M] })).status).toBe(401);
    expect((await app.get(`/api/conversation-voices/sample?voice=${encodeURIComponent(F)}`)).status).toBe(401);
  });

  it('lists the catalogue with the shipped defaults for a new account', async () => {
    const res = await makeApp(db, { id: 'learner' }).get('/api/conversation-voices');
    expect(res.status).toBe(200);
    const body = await res.json() as { voices: unknown[]; enabled: string[]; customised: boolean; default_source: string; speed: number };
    expect(body.voices.length).toBeGreaterThan(20);
    expect(body.enabled).toEqual([...DEFAULT_CONVERSATION_VOICE_IDS]);
    expect(body.customised).toBe(false);
    expect(body.default_source).toBe('app');
    expect(body.speed).toBe(0.9);
  });

  it('saves a valid selection and refuses an invalid one', async () => {
    const app = makeApp(db, { id: 'learner' });
    const ok = await app.put({ enabled: [M, F] });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ enabled: [F, M], customised: true });
    expect(db.rows('SELECT conversation_voices FROM users WHERE id = ?', ['learner'])[0]).toEqual({ conversation_voices: JSON.stringify([F, M]) });

    const noFemale = await app.put({ enabled: [M, M2] });
    expect(noFemale.status).toBe(400);
    expect((await noFemale.json() as { problems: string[] }).problems).toEqual(['Keep at least one female voice on']);

    const unknown = await app.put({ enabled: [F, M, 'made-up'] });
    expect(unknown.status).toBe(400);
    expect((await unknown.json() as { problems: string[] }).problems).toEqual(['Unknown voice: made-up']);

    expect((await app.put({ enabled: 'everything' })).status).toBe(400);
    // Nothing invalid was stored.
    expect(db.rows('SELECT conversation_voices FROM users WHERE id = ?', ['learner'])[0]).toEqual({ conversation_voices: JSON.stringify([F, M]) });
  });

  it("uses the admin's selection as everyone else's default, and reset goes back to it", async () => {
    await makeApp(db, { id: 'admin', is_admin: 1 }).put({ enabled: [F2, M2] });
    const tutor = makeApp(db, { id: 'tutor' });
    expect(await (await tutor.get('/api/conversation-voices')).json()).toMatchObject({
      enabled: [F2, M2], customised: false, default_source: 'admin', default_enabled: [F2, M2],
    });
    await tutor.put({ enabled: [F, M] });
    expect(await (await tutor.get('/api/conversation-voices')).json()).toMatchObject({ enabled: [F, M], customised: true });
    const reset = await tutor.put({ reset: true });
    expect(await reset.json()).toMatchObject({ enabled: [F2, M2], customised: false });
    // The admin's own default is the shipped selection.
    expect(await (await makeApp(db, { id: 'admin', is_admin: 1 }).get('/api/conversation-voices')).json()).toMatchObject({
      enabled: [F2, M2], customised: true, default_source: 'app', default_enabled: [...DEFAULT_CONVERSATION_VOICE_IDS],
    });
  });

  it('makes a voice sample once with MiniMax, then serves it from R2', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: { audio: '4944330300' }, base_resp: { status_code: 0 },
    })));
    vi.stubGlobal('fetch', fetchMock);
    const app = makeApp(db, { id: 'learner' });
    const url = `/api/conversation-voices/sample?voice=${encodeURIComponent(F)}`;
    const first = await app.get(url);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ content_type: 'audio/mpeg', cached: false });
    expect(app.bucket.store.has(voiceSampleKey(F))).toBe(true);
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.voice_setting).toEqual({ voice_id: F, speed: 0.9 });

    const second = await app.get(url);
    expect(await second.json()).toMatchObject({ cached: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses an unknown voice for a sample', async () => {
    const res = await makeApp(db, { id: 'learner' }).get('/api/conversation-voices/sample?voice=nope');
    expect(res.status).toBe(400);
  });
});
