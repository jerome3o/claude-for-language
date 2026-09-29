import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import { makePng } from '../../services/__tests__/picture-hunt-png';
import pictureHunts, { stripJpegMetadata } from '../picture-hunts';
import * as huntDb from '../../db/picture-hunt-queries';
import type { Env } from '../../types';

function fakeBucket() {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    get: vi.fn(async (key: string) => (store.has(key) ? { body: store.get(key), httpMetadata: { contentType: 'image/png' }, arrayBuffer: async () => store.get(key)!.buffer } : null)),
    put: vi.fn(async (key: string, bytes: Uint8Array) => { store.set(key, new Uint8Array(bytes)); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
  };
}

function makeApp(db: SqliteD1, user: { id: string } | null, keys = true) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    if (user) c.set('user', user as never);
    await next();
  });
  app.route('/api', pictureHunts);
  const bucket = fakeBucket();
  const queue = { send: vi.fn(async () => {}) };
  const env = { DB: db, AUDIO_BUCKET: bucket, PICTURE_HUNT_QUEUE: queue, GEMINI_API_KEY: keys ? 'g' : '', ANTHROPIC_API_KEY: keys ? 'a' : '' } as unknown as Env;
  const req = (path: string, init?: RequestInit) => app.request(path, init, env);
  const json = (path: string, method: string, body: unknown) => req(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { req, json, bucket, queue };
}

async function readyHunt(db: SqliteD1, userId: string): Promise<string> {
  const id = await huntDb.createPictureHunt(db, { userId, title: 't', source: 'generated', prompt: 'kitchen', deckIds: null });
  await huntDb.setPictureHuntImage(db, id, `picture-hunts/${id}.png`, 10, 10);
  await huntDb.setPictureHuntReady(db, id, '厨房 · Kitchen', [
    { id: 'o1', hanzi: '杯子', pinyin: 'bēizi', english: 'cup', alternatives: [], regions: [{ box: { x: 0, y: 0, w: 0.5, h: 0.5 } }] },
    { id: 'o2', hanzi: '桌子', pinyin: 'zhuōzi', english: 'table', alternatives: [], regions: [{ box: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } }] },
  ]);
  return id;
}

describe('picture hunt routes', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    db.raw.run("INSERT INTO users (id, email, name) VALUES ('u1', 'u1@x.test', 'U1'), ('u2', 'u2@x.test', 'U2')");
  });

  it('refuses a signed-out caller on every route', async () => {
    const app = makeApp(db, null);
    expect((await app.req('/api/picture-hunts')).status).toBe(401);
    expect((await app.json('/api/picture-hunts', 'POST', { prompt: 'x' })).status).toBe(401);
    expect((await app.req('/api/picture-hunts/upload', { method: 'POST', body: new Uint8Array([1]) })).status).toBe(401);
    expect((await app.req('/api/picture-hunts/x')).status).toBe(401);
    expect((await app.req('/api/picture-hunts/x/image')).status).toBe(401);
    expect((await app.req('/api/picture-hunts/x/retry', { method: 'POST' })).status).toBe(401);
    expect((await app.req('/api/picture-hunts/x', { method: 'DELETE' })).status).toBe(401);
    expect((await app.json('/api/picture-hunts/plays', 'POST', { plays: [] })).status).toBe(401);
  });

  it('creates a generated hunt and queues it; 400 without a prompt; 503 without keys', async () => {
    const app = makeApp(db, { id: 'u1' });
    const res = await app.json('/api/picture-hunts', 'POST', { prompt: ' a street market ', deck_ids: ['d1'] });
    expect(res.status).toBe(202);
    const { hunt } = await res.json() as { hunt: { id: string; status: string; source: string; progress: string } };
    expect(hunt).toMatchObject({ status: 'generating', source: 'generated', progress: 'queued' });
    expect(app.queue.send).toHaveBeenCalledWith({ huntId: hunt.id });
    expect(db.rows('SELECT deck_ids FROM picture_hunts')[0]).toEqual({ deck_ids: '["d1"]' });
    expect((await app.json('/api/picture-hunts', 'POST', { prompt: '  ' })).status).toBe(400);
    expect((await makeApp(db, { id: 'u1' }, false).json('/api/picture-hunts', 'POST', { prompt: 'x' })).status).toBe(503);
  });

  it('stores an upload (metadata stripped) and queues it', async () => {
    const app = makeApp(db, { id: 'u1' });
    const png = makePng(20, 10, () => 128);
    const res = await app.req('/api/picture-hunts/upload?caption=My%20desk', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
    expect(res.status).toBe(202);
    const { hunt } = await res.json() as { hunt: { id: string; title: string; image_width: number } };
    expect(hunt).toMatchObject({ title: 'My desk', image_width: 20 });
    expect(app.bucket.store.has(`picture-hunts/${hunt.id}.png`)).toBe(true);
    expect(app.queue.send).toHaveBeenCalledWith({ huntId: hunt.id });
    const notImage = await app.req('/api/picture-hunts/upload', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array([1, 2, 3, 4]) });
    expect(notImage.status).toBe(400);
  });

  it('strips EXIF / comments from a JPEG and keeps the image data', () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, // APP0 kept
      0xff, 0xe1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66, // APP1 EXIF dropped
      0xff, 0xfe, 0x00, 0x03, 0x41, // COM dropped
      0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9, // SOS + data kept
    ]);
    expect(Array.from(stripJpegMetadata(jpeg))).toEqual([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);
  });

  it('only shows a hunt and its picture to its owner', async () => {
    const id = await readyHunt(db, 'u1');
    const owner = makeApp(db, { id: 'u1' });
    owner.bucket.store.set(`picture-hunts/${id}.png`, new Uint8Array([9, 9]));
    const got = await owner.req(`/api/picture-hunts/${id}`);
    expect(got.status).toBe(200);
    expect(((await got.json()) as { hunt: { objects: unknown[] } }).hunt.objects).toHaveLength(2);
    const img = await owner.req(`/api/picture-hunts/${id}/image`);
    expect(img.status).toBe(200);
    expect(img.headers.get('Cache-Control')).toMatch(/private/);

    const other = makeApp(db, { id: 'u2' });
    expect((await other.req(`/api/picture-hunts/${id}`)).status).toBe(404);
    expect((await other.req(`/api/picture-hunts/${id}/image`)).status).toBe(404);
    expect((await other.req(`/api/picture-hunts/${id}/retry`, { method: 'POST' })).status).toBe(404);
    await other.req(`/api/picture-hunts/${id}`, { method: 'DELETE' });
    expect(db.rows('SELECT id FROM picture_hunts')).toHaveLength(1);
    expect(((await (await other.req('/api/picture-hunts')).json()) as { hunts: unknown[] }).hunts).toHaveLength(0);
  });

  it('records plays idempotently and keeps the best score; drops other users\' hunts', async () => {
    const id = await readyHunt(db, 'u1');
    const app = makeApp(db, { id: 'u1' });
    const play = (pid: string, found: string[]) => ({ id: pid, hunt_id: id, found_ids: found, total: 2, hints_used: 1, gave_up: false, duration_ms: 5000, played_at: '2026-09-01T10:00:00Z' });
    const first = await app.json('/api/picture-hunts/plays', 'POST', { plays: [play('p1', ['o1']), play('p2', ['o1', 'o2', 'bogus'])] });
    const body = await first.json() as { accepted: number; hunts: Array<{ best_found: number; play_count: number }> };
    expect(body.accepted).toBe(2);
    expect(body.hunts[0]).toMatchObject({ best_found: 2, play_count: 2 });
    const again = await app.json('/api/picture-hunts/plays', 'POST', { plays: [play('p1', ['o1'])] });
    expect(((await again.json()) as { accepted: number }).accepted).toBe(0);
    expect(db.rows('SELECT found_count FROM picture_hunt_plays WHERE id = ?', ['p2'])[0]).toEqual({ found_count: 2 });

    const other = makeApp(db, { id: 'u2' });
    const stolen = await (await other.json('/api/picture-hunts/plays', 'POST', { plays: [play('p9', ['o1'])] })).json() as { accepted: number; rejected: string[] };
    expect(stolen).toMatchObject({ accepted: 0, rejected: ['p9'] });
  });

  it('retries only a failed hunt and deletes the hunt with its plays and picture', async () => {
    const app = makeApp(db, { id: 'u1' });
    const id = await readyHunt(db, 'u1');
    expect((await app.req(`/api/picture-hunts/${id}/retry`, { method: 'POST' })).status).toBe(409);
    await huntDb.setPictureHuntError(db, id, 'boom');
    expect((await app.req(`/api/picture-hunts/${id}/retry`, { method: 'POST' })).status).toBe(202);
    expect(db.rows('SELECT status, progress, error FROM picture_hunts WHERE id = ?', [id])[0]).toEqual({ status: 'generating', progress: 'queued', error: null });

    await huntDb.recordPictureHuntPlays(db, 'u1', [{ id: 'p1', hunt_id: id, found_ids: [], total: 2, hints_used: 0, gave_up: true, duration_ms: 1, played_at: '2026-09-01T00:00:00Z' }]);
    app.bucket.store.set(`picture-hunts/${id}.png`, new Uint8Array([1]));
    expect((await app.req(`/api/picture-hunts/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect(db.rows('SELECT id FROM picture_hunts')).toHaveLength(0);
    expect(db.rows('SELECT id FROM picture_hunt_plays')).toHaveLength(0);
    expect(app.bucket.store.size).toBe(0);
  });
});
