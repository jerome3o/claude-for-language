/**
 * Chat round 2 PR 3: files / PDFs and video clips (what may be uploaded, how
 * they are served), and forwarding a message into another conversation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import chatLive from '../chat-live';
import chatMessages from '../chat-messages';
import { cleanFileName, inspectUpload, messagePreviewText, sniffVideo, ChatMediaError } from '../../services/chat/media';
import type { Env, MessageWithSender } from '../../types';

const TUTOR = 'tutor-1';
const STUDENT = 'student-1';

function world(db: SqliteD1) {
  const store = new Map<string, Uint8Array>();
  const bucket = {
    put: async (key: string, value: Uint8Array | ArrayBuffer) => void store.set(key, new Uint8Array(value as ArrayBuffer)),
    get: async (key: string) => {
      const b = store.get(key);
      return b ? { body: b, size: b.length, httpEtag: '"e"', httpMetadata: {}, arrayBuffer: async () => b.slice().buffer } : null;
    },
    delete: async (k: string) => void store.delete(k),
  };
  const hub = { idFromName: (n: string) => n, get: () => ({ broadcast: async () => 1 }) };
  const env = { DB: db, SESSION_SECRET: 's', AUDIO_BUCKET: bucket, CHAT_HUB: hub } as unknown as Env;
  const as = (userId: string) => {
    const app = new Hono<{ Bindings: Env }>();
    app.use('/api/*', async (c, next) => {
      c.set('user', { id: userId } as never);
      await next();
    });
    app.route('/api', chatLive);
    app.route('/api', chatMessages);
    return {
      upload: (conv: string, q: string, bytes: Uint8Array, type = 'application/octet-stream') =>
        app.request(`/api/conversations/${conv}/media?${q}`, { method: 'POST', headers: { 'Content-Type': type }, body: bytes }, env),
      call: (method: string, path: string, body?: unknown) =>
        app.request(path, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env),
    };
  };
  return { store, as };
}

const pdf = () => new TextEncoder().encode('%PDF-1.4\n%âãÏÓ\n1 0 obj << >> endobj\n%%EOF');
const mp4 = () => {
  const b = new Uint8Array(64);
  b.set([0, 0, 0, 0x18], 0);
  b.set(new TextEncoder().encode('ftypisom'), 4);
  return b;
};

describe('chat files, video and forwarding', () => {
  let db: SqliteD1;
  let w: ReturnType<typeof world>;

  beforeEach(async () => {
    db = await createSqliteD1();
    for (const [id, name] of [[TUTOR, 'Minghui'], [STUDENT, 'Jerome'], ['stranger', 'Nobody']]) {
      db.raw.run('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', [id, `${id}@x.test`, name, 'student']);
    }
    db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'tutor', 'active')", [TUTOR, STUDENT]);
    db.raw.run("INSERT INTO conversations (id, relationship_id) VALUES ('conv-1', 'rel-1')");
    db.raw.run("INSERT INTO conversations (id, relationship_id) VALUES ('conv-2', 'rel-1')");
    db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-2', 'stranger', ?, 'tutor', 'active')", [TUTOR]);
    db.raw.run("INSERT INTO conversations (id, relationship_id) VALUES ('conv-x', 'rel-2')");
    w = world(db);
  });

  it('file names are cleaned and kinds checked', () => {
    expect(cleanFileName('C:\\Users\\me\\作业 第3课.pdf')).toBe('作业 第3课.pdf');
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('a\u0000b.txt')).toBe('ab.txt');
    expect(cleanFileName('')).toBeNull();
    expect(cleanFileName('x'.repeat(300) + '.docx')!.length).toBe(200);
    expect(cleanFileName('x'.repeat(300) + '.docx')!.endsWith('.docx')).toBe(true);
    expect(() => inspectUpload('file', new Uint8Array([1, 2]), { name: 'evil.html' })).toThrow(ChatMediaError);
    expect(() => inspectUpload('file', new Uint8Array([1, 2]), { name: 'fake.pdf' })).toThrow(/damaged/);
    expect(() => inspectUpload('file', new Uint8Array([1, 2]), {})).toThrow(/name/);
    expect(inspectUpload('file', new Uint8Array([1, 2]), { name: 'notes.docx' }).attachment).toMatchObject({ kind: 'file', name: 'notes.docx', mime: expect.stringContaining('wordprocessingml') });
    expect(sniffVideo(mp4())).toBe('video/mp4');
    expect(sniffVideo(new Uint8Array(16))).toBeNull();
    expect(() => inspectUpload('video', new Uint8Array(16), {})).toThrow(/MP4/);
    expect(messagePreviewText({ content: '', deleted_at: null, attachment: { kind: 'file', name: 'HSK3.pdf', bytes: 1, mime: 'application/pdf' } })).toBe('📄 HSK3.pdf');
    expect(messagePreviewText({ content: '看这个', deleted_at: null, attachment: { kind: 'video', bytes: 1, mime: 'video/mp4' } })).toBe('🎬 Video: 看这个');
  });

  it('a PDF is stored, served inline under its name, sandboxed; other files download', async () => {
    const res = await w.as(STUDENT).upload('conv-1', 'kind=file&name=%E4%BD%9C%E4%B8%9A.pdf&client_id=f1', pdf());
    expect(res.status).toBe(201);
    const msg = (await res.json()) as MessageWithSender;
    expect(msg.attachment).toEqual({ kind: 'file', name: '作业.pdf', bytes: pdf().length, mime: 'application/pdf' });
    expect(msg.media_url).toBe(`/api/chat-media/${msg.id}`);
    const got = await w.as(TUTOR).call('GET', `/api/chat-media/${msg.id}`);
    expect(got.status).toBe(200);
    expect(got.headers.get('Content-Disposition')).toBe(`inline; filename*=UTF-8''${encodeURIComponent('作业.pdf')}`);
    expect(got.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(got.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect((await w.as('stranger').call('GET', `/api/chat-media/${msg.id}`)).status).toBe(403);

    const doc = await w.as(STUDENT).upload('conv-1', 'kind=file&name=notes.txt', new TextEncoder().encode('你好'));
    const d = (await doc.json()) as MessageWithSender;
    expect((await w.as(TUTOR).call('GET', `/api/chat-media/${d.id}`)).headers.get('Content-Disposition')).toMatch(/^attachment;/);
    expect((await w.as(STUDENT).upload('conv-1', 'kind=file&name=x.svg', new Uint8Array([60]))).status).toBe(415);
    const big = await w.as(STUDENT).upload('conv-1', 'kind=file&name=big.zip', new Uint8Array(20 * 1024 * 1024 + 1));
    expect(big.status).toBe(413);
  });

  it('a video clip keeps the size and length the phone measured', async () => {
    const res = await w.as(STUDENT).upload('conv-1', 'kind=video&duration_ms=4200&width=720&height=1280&caption=%E7%9C%8B', mp4());
    expect(res.status).toBe(201);
    const msg = (await res.json()) as MessageWithSender;
    expect(msg.attachment).toEqual({ kind: 'video', bytes: 64, mime: 'video/mp4', duration_ms: 4200, width: 720, height: 1280 });
    expect(msg.content).toBe('看');
  });

  it('forward: a copy with its own media, marked, idempotent, only into my conversations', async () => {
    const up = (await (await w.as(TUTOR).upload('conv-1', 'kind=file&name=lesson.pdf', pdf())).json()) as MessageWithSender;
    const fwd = await w.as(STUDENT).call('POST', `/api/messages/${up.id}/forward`, { conversation_id: 'conv-2', client_id: 'fw-1' });
    expect(fwd.status).toBe(201);
    const copy = (await fwd.json()) as MessageWithSender;
    expect(copy.conversation_id).toBe('conv-2');
    expect(copy.sender_id).toBe(STUDENT);
    expect(copy.forwarded_from).toBe(up.id);
    expect(copy.attachment).toEqual(up.attachment);
    expect([...w.store.keys()].filter((k) => k.startsWith('chat-media/conv-2/'))).toHaveLength(1);
    // Same client_id → the same message, no second copy.
    const again = await w.as(STUDENT).call('POST', `/api/messages/${up.id}/forward`, { conversation_id: 'conv-2', client_id: 'fw-1' });
    expect(again.status).toBe(200);
    expect(((await again.json()) as MessageWithSender).id).toBe(copy.id);
    // Deleting the original leaves the copy's file.
    await w.as(TUTOR).call('DELETE', `/api/messages/${up.id}`);
    expect((await w.as(TUTOR).call('GET', `/api/chat-media/${copy.id}`)).status).toBe(200);

    db.raw.run("INSERT INTO messages (id, conversation_id, sender_id, content, created_at) VALUES ('t1', 'conv-1', ?, '明天见', '2026-10-02T09:00:00.000Z')", [TUTOR]);
    expect((await w.as(STUDENT).call('POST', '/api/messages/t1/forward', { conversation_id: 'conv-x' })).status).toBe(403);
    expect((await w.as('stranger').call('POST', '/api/messages/t1/forward', { conversation_id: 'conv-x' })).status).toBe(403);
    expect((await w.as(STUDENT).call('POST', '/api/messages/t1/forward', {})).status).toBe(400);
    const text = (await (await w.as(TUTOR).call('POST', '/api/messages/t1/forward', { conversation_id: 'conv-x' })).json()) as MessageWithSender;
    expect(text).toMatchObject({ content: '明天见', conversation_id: 'conv-x', forwarded_from: 't1', attachment: null });
    expect((await w.as(STUDENT).call('POST', `/api/messages/${up.id}/forward`, { conversation_id: 'conv-2' })).status).toBe(409);
  });
});
