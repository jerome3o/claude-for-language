/**
 * Lesson materials over the API, against real SQLite and a fake R2: upload →
 * pages → complete, who may see what (owner, a shared relationship, nobody
 * else), the page text for agents, share / unshare, delete (rows + R2).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../../types';
import materials from '../materials';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';

const TUTOR = 'tutor-1';
const STUDENT = 'student-1';
const STRANGER = 'stranger';
let db: SqliteD1;
let bucket: Map<string, Uint8Array>;
const exec = (sql: string, ...params: Array<string | number | null>) => db.raw.run(sql, params);

// A 1×1 PNG.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

function app(userId: string) {
  const a = new Hono<{ Bindings: Env }>();
  a.use('*', async (c, next) => {
    c.set('user', { id: userId } as never);
    await next();
  });
  a.route('/api', materials);
  const r2 = {
    put: async (k: string, v: ArrayBuffer) => void bucket.set(k, new Uint8Array(v)),
    get: async (k: string) => (bucket.has(k) ? { body: bucket.get(k), httpMetadata: { contentType: 'image/png' } } : null),
    delete: async (ks: string | string[]) => void (Array.isArray(ks) ? ks : [ks]).forEach((k) => bucket.delete(k)),
  };
  const env = { DB: db, AUDIO_BUCKET: r2 } as unknown as Env;
  return async (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const { json, ...rest } = init;
    const res = await a.request(path, json === undefined ? rest : { ...rest, body: JSON.stringify(json), headers: { 'content-type': 'application/json' } }, env);
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? ((await res.json()) as Record<string, any>) : null };
  };
}

beforeEach(async () => {
  db = await createSqliteD1();
  bucket = new Map();
  for (const [id, email] of [[TUTOR, 't@x'], [STUDENT, 's@x'], [STRANGER, 'z@x']]) exec('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', id, email, id);
  exec("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'tutor', 'active')", TUTOR, STUDENT);
});

describe('materials API', () => {
  it('upload → pages → complete; the owner sees it, the student only once shared, a stranger never', async () => {
    const tutor = app(TUTOR);
    const bad = await tutor('/api/materials', { method: 'POST', json: { file_name: 'old.ppt', size: 100 } });
    expect(bad.status).toBe(400);
    expect(bad.body!.error).toMatch(/\.pptx/);
    const big = await tutor('/api/materials', { method: 'POST', json: { file_name: 'big.pdf', size: 60 * 1024 * 1024 } });
    expect(big.status).toBe(413);

    const made = await tutor('/api/materials', { method: 'POST', json: { file_name: 'Lesson 5 – 把字句.pptx', mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', size: 2048 } });
    expect(made.status).toBe(201);
    const id = made.body!.material.id as string;
    expect(made.body!.material).toMatchObject({ title: 'Lesson 5 – 把字句', kind: 'pptx', status: 'uploading' });
    expect((await tutor(`/api/materials/${id}/original`, { method: 'PUT', body: new Uint8Array(2048) })).status).toBe(200);
    // Completing before the pages are there is refused.
    expect((await tutor(`/api/materials/${id}/complete`, { method: 'POST', json: { pages: [] } })).status).toBe(409);
    expect((await tutor(`/api/materials/${id}/pages/0`, { method: 'PUT', body: new Uint8Array([1, 2, 3]) })).status).toBe(400);
    for (const n of [0, 1]) expect((await tutor(`/api/materials/${id}/pages/${n}`, { method: 'PUT', body: PNG })).status).toBe(200);
    const done = await tutor(`/api/materials/${id}/complete`, {
      method: 'POST',
      json: { pages: [{ index: 0, text: '第五课 把字句' }, { index: 1, text: '我把作业做完了。', notes: 'Ask for examples' }], render_note: 'Slides drawn from their text' },
    });
    expect(done.body!.material).toMatchObject({ status: 'ready', page_count: 2, has_text: true });
    expect([...bucket.keys()].every((k) => k.startsWith(`materials/${TUTOR}/${id}/`))).toBe(true);

    const got = await tutor(`/api/materials/${id}`);
    expect(got.body!.pages.map((p: { image_url: string }) => p.image_url)).toEqual([`/api/materials/${id}/pages/0/image`, `/api/materials/${id}/pages/1/image`]);
    expect((await tutor(`/api/materials/${id}/pages/1/image`)).status).toBe(200);
    const text = await tutor(`/api/materials/${id}/text?from=2`);
    expect(text.body!.pages).toEqual([{ page: 2, text: '我把作业做完了。', notes: 'Ask for examples' }]);

    const student = app(STUDENT);
    expect((await student(`/api/materials/${id}`)).status).toBe(404);
    expect((await student('/api/materials')).body!.materials).toEqual([]);
    expect((await tutor(`/api/materials/${id}/share`, { method: 'POST', json: { relationship_id: 'rel-1' } })).status).toBe(200);
    expect((await student(`/api/materials/${id}`)).status).toBe(200);
    expect((await student(`/api/materials/${id}/pages/0/image`)).status).toBe(200);
    const list = (await student('/api/materials')).body!.materials;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ mine: false, owner_name: TUTOR });
    // The student can't change or delete it.
    expect((await student(`/api/materials/${id}`, { method: 'DELETE' })).status).toBe(403);
    expect((await app(STRANGER)(`/api/materials/${id}`)).status).toBe(404);
    expect((await tutor(`/api/materials?relationship_id=rel-1`)).body!.materials).toHaveLength(1);

    expect((await tutor(`/api/materials/${id}/share/rel-1`, { method: 'DELETE' })).status).toBe(200);
    expect((await student(`/api/materials/${id}`)).status).toBe(404);
    expect((await tutor(`/api/materials/${id}`, { method: 'PATCH', json: { title: '  第五课  ' } })).body!.material.title).toBe('第五课');
    expect((await tutor(`/api/materials/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect(bucket.size).toBe(0);
    expect(db.rows('SELECT * FROM material_pages')).toEqual([]);
  });
});
