/**
 * Rich chat messages (docs/CHAT.md PR 2) against real SQLite with every
 * migration: `?since=` returning changed messages, photo / voice uploads
 * (magic bytes, limits, idempotency, membership), serving media, the voice
 * transcript (done / failed), edit / delete / pin / reactions permissions and
 * their `message_updated` broadcasts, unread counts, the storage registry.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import chatLive from '../chat-live';
import chatMessages from '../chat-messages';
import { getConversations } from '../../services/conversations';
import { transcribeVoiceMessage } from '../../services/chat/messages';
import { chatMessageFcmData, chatMessageWebPush } from '../../services/chat/notify';
import { inspectUpload, messagePreviewText, sniffAudio, IMAGE_MAX_BYTES, ChatMediaError } from '../../services/chat/media';
import { collectReferences, prefixFor, STORAGE_PREFIXES } from '../../services/admin/storage-cleanup';
import type { Env, MessageWithSender } from '../../types';

const TUTOR = 'tutor-1';
const STUDENT = 'student-1';

function seed(db: SqliteD1) {
  for (const [id, name] of [[TUTOR, 'Minghui'], [STUDENT, 'Jerome'], ['stranger', 'Nobody']]) {
    db.raw.run('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', [id, `${id}@x.test`, name, 'student']);
  }
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'tutor', 'active')", [TUTOR, STUDENT]);
  db.raw.run("INSERT INTO conversations (id, relationship_id, title) VALUES ('conv-1', 'rel-1', 'Homework')");
  db.raw.run("INSERT INTO conversations (id, relationship_id, title) VALUES ('conv-2', 'rel-1', NULL)");
}

function insertMessage(db: SqliteD1, id: string, conv: string, sender: string, at: string, content = '你好') {
  db.raw.run('INSERT INTO messages (id, conversation_id, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?)', [id, conv, sender, content, at]);
}

function fakeBucket() {
  const store = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  const bucket = {
    put: async (key: string, value: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) => {
      store.set(key, { bytes: new Uint8Array(value), contentType: opts?.httpMetadata?.contentType });
      return {};
    },
    get: async (key: string) => {
      const o = store.get(key);
      if (!o) return null;
      return { body: o.bytes, size: o.bytes.length, httpEtag: '"e"', httpMetadata: { contentType: o.contentType } };
    },
    delete: async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
  };
  return { bucket, store };
}

function fakeHubs() {
  const events: Array<{ user: string; event: { type: string; message?: MessageWithSender } }> = [];
  const ns = {
    idFromName: (name: string) => name,
    get: (id: string) => ({
      broadcast: async (event: { type: string; message?: MessageWithSender }) => {
        events.push({ user: id, event });
        return 1;
      },
    }),
  };
  return { ns, events };
}

type Ctx = ReturnType<typeof makeWorld>;

function makeWorld(db: SqliteD1, extraEnv: Partial<Env> = {}) {
  const r2 = fakeBucket();
  const hubs = fakeHubs();
  const env = { DB: db, SESSION_SECRET: 'test-secret', AUDIO_BUCKET: r2.bucket, CHAT_HUB: hubs.ns, ...extraEnv } as unknown as Env;
  const as = (userId: string) => {
    const app = new Hono<{ Bindings: Env }>();
    app.use('/api/*', async (c, next) => {
      c.set('user', { id: userId } as never);
      await next();
    });
    app.route('/api', chatLive);
    app.route('/api', chatMessages);
    const call = (method: string, path: string, body?: unknown) =>
      app.request(path, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    const upload = (conv: string, query: string, bytes: Uint8Array, contentType: string) =>
      app.request(`/api/conversations/${conv}/media?${query}`, { method: 'POST', headers: { 'Content-Type': contentType }, body: bytes }, env);
    return { call, upload };
  };
  return { env, r2, hubs, as };
}

/** A PNG header that declares w × h. */
function png(w: number, h: number, extra = 16): Uint8Array {
  const b = new Uint8Array(33 + extra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}

/** A JPEG with an EXIF APP1 segment and a SOF0 declaring w × h. */
function jpegWithExif(w: number, h: number): Uint8Array {
  const exif = [0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0xff, 0xd9];
  return new Uint8Array([0xff, 0xd8, ...exif, ...sof, ...sos]);
}

function webm(size = 64): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0x1a, 0x45, 0xdf, 0xa3]);
  return b;
}

const json = async <T = MessageWithSender>(res: Response) => (await res.json()) as T;

describe('rich chat messages', () => {
  let db: SqliteD1;
  let w: Ctx;

  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
    w = makeWorld(db);
  });

  it('?since= returns new AND changed messages; latest_timestamp is the newest creation or change', async () => {
    insertMessage(db, 'm-1', 'conv-1', TUTOR, '2026-10-01T09:00:00.000Z', '第一');
    insertMessage(db, 'm-2', 'conv-1', STUDENT, '2026-10-01T09:01:00.000Z', '第二');
    insertMessage(db, 'm-3', 'conv-1', TUTOR, '2026-10-01T09:02:00.000Z', '第三');
    db.raw.run("UPDATE messages SET reply_to_message_id = 'm-1' WHERE id = 'm-3'");
    const student = w.as(STUDENT);

    let page = await json<{ messages: MessageWithSender[]; latest_timestamp: string }>(await student.call('GET', '/api/conversations/conv-1/messages'));
    expect(page.messages.map((m) => m.id)).toEqual(['m-1', 'm-2', 'm-3']);
    expect(page.latest_timestamp).toBe('2026-10-01T09:02:00.000Z');
    expect(page.messages[0]).toMatchObject({ updated_at: null, edited_at: null, deleted_at: null, attachment: null, media_url: null, pinned_at: null, pinned_by: null });

    // Nothing new: an empty page, the cursor stays.
    page = await json(await student.call('GET', `/api/conversations/conv-1/messages?since=${encodeURIComponent(page.latest_timestamp)}`));
    expect(page.messages).toEqual([]);
    expect(page.latest_timestamp).toBe('2026-10-01T09:02:00.000Z');

    // The tutor deletes m-1 (an old message): it comes back with deleted_at, and the reply preview says deleted.
    const del = await w.as(TUTOR).call('DELETE', '/api/messages/m-1');
    expect(del.status).toBe(200);
    page = await json(await student.call('GET', '/api/conversations/conv-1/messages?since=2026-10-01T09:02:00.000Z'));
    expect(page.messages.map((m) => m.id)).toEqual(['m-1']);
    expect(page.messages[0]).toMatchObject({ content: '', attachment: null });
    expect(page.messages[0].deleted_at).toBeTruthy();
    expect(page.latest_timestamp).toBe(page.messages[0].updated_at);
    const full = await json<{ messages: MessageWithSender[] }>(await student.call('GET', '/api/conversations/conv-1/messages'));
    expect(full.messages.find((m) => m.id === 'm-3')!.reply_to).toMatchObject({ id: 'm-1', content: '' });
    expect(full.messages.find((m) => m.id === 'm-3')!.reply_to!.deleted_at).toBeTruthy();
  });

  it('uploads a photo: magic bytes decide, EXIF is stripped, the key never leaves the server', async () => {
    const tutor = w.as(TUTOR);
    const bytes = jpegWithExif(1600, 1200);
    const res = await tutor.upload('conv-1', 'kind=image&client_id=photo-1&caption=' + encodeURIComponent('我的猫'), bytes, 'image/jpeg');
    expect(res.status).toBe(201);
    const msg = await json(res);
    expect(msg.content).toBe('我的猫');
    expect(msg.attachment).toEqual({ kind: 'image', width: 1600, height: 1200, bytes: bytes.length - 10, mime: 'image/jpeg' });
    expect(msg.media_url).toBe(`/api/chat-media/${msg.id}`);
    expect(JSON.stringify(msg)).not.toContain('chat-media/conv-1');
    const key = `chat-media/conv-1/${msg.id}.jpg`;
    expect([...w.r2.store.keys()]).toEqual([key]);
    expect(w.r2.store.get(key)!.bytes.length).toBe(bytes.length - 10);
    // The key is stored (for clean-up / deletion) inside the attachment JSON.
    expect(JSON.parse(db.rows<{ attachment: string }>('SELECT attachment FROM messages WHERE id = ?', [msg.id])[0].attachment).key).toBe(key);
    // Notified like a text message, with a photo preview.
    expect(db.rows("SELECT title, message FROM notifications WHERE user_id = ? AND type = 'new_chat_message'", [STUDENT])).toEqual([
      { title: 'New message from Minghui', message: '📷 Photo: 我的猫' },
    ]);
    expect(w.hubs.events.filter((e) => e.event.type === 'message').map((e) => e.user).sort()).toEqual([STUDENT, TUTOR]);

    // Idempotent by client_id: same message, nothing stored or notified again.
    const again = await tutor.upload('conv-1', 'kind=image&client_id=photo-1', bytes, 'image/jpeg');
    expect(again.status).toBe(200);
    expect((await json(again)).id).toBe(msg.id);
    expect(w.r2.store.size).toBe(1);
    expect(db.rows('SELECT id FROM messages')).toHaveLength(1);
  });

  it('refuses what is not a photo / voice message, too big, or not in the conversation', async () => {
    const tutor = w.as(TUTOR);
    const text = new TextEncoder().encode('<html>definitely not a png</html>');
    expect((await tutor.upload('conv-1', 'kind=image', text, 'image/png')).status).toBe(415);
    expect((await tutor.upload('conv-1', 'kind=image', png(10, 10), 'text/html')).status).toBe(415);
    expect((await tutor.upload('conv-1', 'kind=voice&duration_ms=1000', png(10, 10), 'audio/webm')).status).toBe(415);
    expect((await tutor.upload('conv-1', 'kind=sticker', png(10, 10), 'image/png')).status).toBe(400);
    expect((await tutor.upload('conv-1', 'kind=video', png(10, 10), 'image/png')).status).toBe(415); // a photo is not a video
    expect((await tutor.upload('conv-1', 'kind=voice', webm(), 'audio/webm')).status).toBe(400); // no duration
    expect((await tutor.upload('conv-1', 'kind=voice&duration_ms=300001', webm(), 'audio/webm')).status).toBe(400); // > 5 min
    expect((await tutor.upload('conv-1', 'kind=image', new Uint8Array(0), 'image/png')).status).toBe(400);
    const big = new Uint8Array(IMAGE_MAX_BYTES + 1);
    big.set(png(10, 10));
    expect((await tutor.upload('conv-1', 'kind=image', big, 'image/png')).status).toBe(413);
    expect((await tutor.upload('conv-1', 'kind=image&client_id=has spaces', png(10, 10), 'image/png')).status).toBe(400);
    expect((await w.as('stranger').upload('conv-1', 'kind=image', png(10, 10), 'image/png')).status).toBe(403);
    expect((await tutor.upload('nope', 'kind=image', png(10, 10), 'image/png')).status).toBe(404);
    expect(w.r2.store.size).toBe(0);
    expect(db.rows('SELECT id FROM messages')).toHaveLength(0);
    // A PNG is fine, with its size read from the header.
    const ok = await json(await tutor.upload('conv-1', 'kind=image', png(800, 600), 'image/png'));
    expect(ok.attachment).toMatchObject({ kind: 'image', width: 800, height: 600, mime: 'image/png' });
  });

  it('serves media to the two participants only, privately cached; 404 once deleted (and the object is gone)', async () => {
    const bytes = png(4, 3);
    const msg = await json(await w.as(TUTOR).upload('conv-1', 'kind=image', bytes, 'image/png'));
    for (const user of [TUTOR, STUDENT]) {
      const res = await w.as(user).call('GET', `/api/chat-media/${msg.id}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
      expect(res.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    }
    expect((await w.as('stranger').call('GET', `/api/chat-media/${msg.id}`)).status).toBe(403);
    expect((await w.as(TUTOR).call('GET', '/api/chat-media/nope')).status).toBe(404);
    // Only the sender deletes.
    expect((await w.as(STUDENT).call('DELETE', `/api/messages/${msg.id}`)).status).toBe(403);
    const del = await json(await w.as(TUTOR).call('DELETE', `/api/messages/${msg.id}`));
    expect(del).toMatchObject({ content: '', attachment: null, media_url: null });
    expect(w.r2.store.size).toBe(0);
    expect((await w.as(STUDENT).call('GET', `/api/chat-media/${msg.id}`)).status).toBe(404);
    // Deleting twice is fine.
    expect((await w.as(TUTOR).call('DELETE', `/api/messages/${msg.id}`)).status).toBe(200);
  });

  it('voice: transcribed in the background → done, translated, message_updated to both', async () => {
    const calls: string[] = [];
    w = makeWorld(db, { AI: { run: async (model: string) => { calls.push(model); return { text: '  明天见  ' }; } } as never });
    const res = await w.as(STUDENT).upload('conv-1', 'kind=voice&duration_ms=2500&client_id=v1', webm(), 'audio/webm;codecs=opus');
    expect(res.status).toBe(201);
    const msg = await json(res);
    // The response is written before the transcript: pending.
    expect(msg.attachment).toEqual({ kind: 'voice', duration_ms: 2500, bytes: 64, mime: 'audio/webm', transcript_status: 'pending', transcript: null, translation: null });
    expect(calls).toHaveLength(1);
    expect(db.rows("SELECT message FROM notifications WHERE user_id = ?", [TUTOR])).toEqual([{ message: '🎤 Voice message' }]);
    expect(w.r2.store.has(`chat-media/conv-1/${msg.id}.webm`)).toBe(true);

    const page = await json<{ messages: MessageWithSender[] }>(await w.as(TUTOR).call('GET', `/api/conversations/conv-1/messages?since=${encodeURIComponent(msg.created_at)}`));
    expect(page.messages.map((m) => m.id)).toEqual([msg.id]);
    expect(page.messages[0].attachment).toMatchObject({ transcript_status: 'done', transcript: '明天见', translation: null });
    expect(page.messages[0].updated_at! > msg.created_at).toBe(true);
    const updates = w.hubs.events.filter((e) => e.event.type === 'message_updated');
    expect(updates.map((e) => e.user).sort()).toEqual([STUDENT, TUTOR]);
    expect(updates[0].event.message!.attachment).toMatchObject({ transcript_status: 'done' });

    // The service translates when it can.
    db.raw.run("UPDATE messages SET attachment = json_set(attachment, '$.transcript_status', 'pending') WHERE id = ?", [msg.id]);
    const status = await transcribeVoiceMessage(w.env, msg.id, webm(), 'audio/webm', {
      providers: { whisper: async () => ({ text: '你好' }) },
      translate: async () => ({ translation: 'Hello', segmentation: {} }),
    });
    expect(status).toBe('done');
    const att = JSON.parse(db.rows<{ attachment: string }>('SELECT attachment FROM messages WHERE id = ?', [msg.id])[0].attachment);
    expect(att).toMatchObject({ transcript_status: 'done', transcript: '你好', translation: 'Hello', key: `chat-media/conv-1/${msg.id}.webm` });
  });

  it('voice: every provider failing → failed (the message stays, nothing throws)', async () => {
    w = makeWorld(db, { AI: { run: async () => { throw new Error('3040: Capacity temporarily exceeded'); } } as never });
    const res = await w.as(STUDENT).upload('conv-1', 'kind=voice&duration_ms=900', webm(), 'audio/webm');
    expect(res.status).toBe(201);
    const msg = await json(res);
    const stored = await json<{ messages: MessageWithSender[] }>(await w.as(STUDENT).call('GET', '/api/conversations/conv-1/messages'));
    expect(stored.messages[0].attachment).toMatchObject({ transcript_status: 'failed', transcript: null });
    expect(w.hubs.events.some((e) => e.event.type === 'message_updated' && e.event.message!.id === msg.id)).toBe(true);
    // An empty transcript counts as failed, and a message deleted meanwhile is left alone.
    expect(await transcribeVoiceMessage(w.env, msg.id, webm(), 'audio/webm', { providers: { whisper: async () => ({ text: '  ' }) } })).toBe('failed');
    await w.as(STUDENT).call('DELETE', `/api/messages/${msg.id}`);
    expect(await transcribeVoiceMessage(w.env, msg.id, webm(), 'audio/webm', { providers: { whisper: async () => ({ text: '好' }) } })).toBe('skipped');
  });

  it('edit: sender only, not deleted, text required (a caption may be empty), voice not editable', async () => {
    insertMessage(db, 'm-1', 'conv-1', TUTOR, '2026-10-01T09:00:00.000Z', '明天见');
    db.raw.run("UPDATE messages SET translation = 'See you tomorrow', segmentation = '{}' WHERE id = 'm-1'");
    const tutor = w.as(TUTOR);
    expect((await w.as(STUDENT).call('PATCH', '/api/messages/m-1', { content: 'x' })).status).toBe(403);
    expect((await w.as('stranger').call('PATCH', '/api/messages/m-1', { content: 'x' })).status).toBe(403);
    expect((await tutor.call('PATCH', '/api/messages/nope', { content: 'x' })).status).toBe(404);
    expect((await tutor.call('PATCH', '/api/messages/m-1', { content: '  ' })).status).toBe(400);
    expect((await tutor.call('PATCH', '/api/messages/m-1', {})).status).toBe(400);

    const res = await tutor.call('PATCH', '/api/messages/m-1', { content: '后天见' });
    expect(res.status).toBe(200);
    const edited = await json(res);
    expect(edited).toMatchObject({ content: '后天见', translation: null, segmentation: null });
    expect(edited.edited_at).toBeTruthy();
    expect(edited.updated_at).toBe(edited.edited_at);
    expect(w.hubs.events.filter((e) => e.event.type === 'message_updated').map((e) => e.user).sort()).toEqual([STUDENT, TUTOR]);
    expect(w.hubs.events.find((e) => e.user === STUDENT)!.event.message!.content).toBe('后天见');

    // A photo's caption can be edited (also to nothing); a voice message cannot.
    const photo = await json(await tutor.upload('conv-1', 'kind=image&caption=cat', png(2, 2), 'image/png'));
    expect((await json(await tutor.call('PATCH', `/api/messages/${photo.id}`, { content: '' }))).content).toBe('');
    w = makeWorld(db);
    const voice = await json(await w.as(TUTOR).upload('conv-1', 'kind=voice&duration_ms=500', webm(), 'audio/webm'));
    expect((await w.as(TUTOR).call('PATCH', `/api/messages/${voice.id}`, { content: 'hi' })).status).toBe(400);

    // Deleted: no more edits.
    await w.as(TUTOR).call('DELETE', '/api/messages/m-1');
    expect((await w.as(TUTOR).call('PATCH', '/api/messages/m-1', { content: 'again' })).status).toBe(409);
  });

  it('pin: either participant, not a stranger; deleted messages unpin; reactions bump updated_at', async () => {
    insertMessage(db, 'm-1', 'conv-1', TUTOR, '2026-10-01T09:00:00.000Z', '作业');
    const student = w.as(STUDENT);
    expect((await student.call('POST', '/api/messages/m-1/pin', {})).status).toBe(400);
    expect((await w.as('stranger').call('POST', '/api/messages/m-1/pin', { pinned: true })).status).toBe(403);
    const pinned = await json(await student.call('POST', '/api/messages/m-1/pin', { pinned: true }));
    expect(pinned.pinned_by).toBe(STUDENT);
    expect(pinned.pinned_at).toBeTruthy();
    expect(w.hubs.events.filter((e) => e.event.type === 'message_updated')).toHaveLength(2);
    // Pinning again changes nothing (no broadcast).
    await student.call('POST', '/api/messages/m-1/pin', { pinned: true });
    expect(w.hubs.events.filter((e) => e.event.type === 'message_updated')).toHaveLength(2);
    const unpinned = await json(await w.as(TUTOR).call('POST', '/api/messages/m-1/pin', { pinned: false }));
    expect(unpinned).toMatchObject({ pinned_at: null, pinned_by: null });

    // Reactions: updated_at moves and both hubs hear about it.
    const before = db.rows<{ updated_at: string }>("SELECT updated_at FROM messages WHERE id = 'm-1'")[0].updated_at;
    const r = await student.call('POST', '/api/messages/m-1/reactions', { emoji: '👍' });
    expect(await r.json()).toEqual({ added: true });
    const after = db.rows<{ updated_at: string }>("SELECT updated_at FROM messages WHERE id = 'm-1'")[0].updated_at;
    expect(after > before).toBe(true);
    const last = w.hubs.events.filter((e) => e.event.type === 'message_updated').slice(-2);
    expect(last.map((e) => e.user).sort()).toEqual([STUDENT, TUTOR]);
    expect(last[0].event.message!.reactions).toEqual([{ emoji: '👍', users: [{ id: STUDENT, name: 'Jerome' }], count: 1 }]);
    expect((await w.as('stranger').call('POST', '/api/messages/m-1/reactions', { emoji: '👍' })).status).toBe(403);
    expect((await student.call('POST', '/api/messages/m-1/reactions', {})).status).toBe(400);

    // A pinned message that gets deleted is unpinned and cannot be pinned again.
    await student.call('POST', '/api/messages/m-1/pin', { pinned: true });
    const deleted = await json(await w.as(TUTOR).call('DELETE', '/api/messages/m-1'));
    expect(deleted.pinned_at).toBeNull();
    expect((await student.call('POST', '/api/messages/m-1/pin', { pinned: true })).status).toBe(409);
  });

  it('conversation list: unread per conversation (non-deleted, after my marker), last message with attachment / deleted', async () => {
    insertMessage(db, 'm-1', 'conv-1', TUTOR, '2026-10-01T09:00:00.000Z');
    insertMessage(db, 'm-2', 'conv-1', TUTOR, '2026-10-01T09:01:00.000Z');
    insertMessage(db, 'm-3', 'conv-1', STUDENT, '2026-10-01T09:02:00.000Z');
    insertMessage(db, 'm-4', 'conv-1', TUTOR, '2026-10-01T09:03:00.000Z');
    insertMessage(db, 'm-5', 'conv-2', TUTOR, '2026-10-01T10:00:00.000Z');
    db.raw.run("UPDATE conversations SET last_message_at = '2026-10-01T10:00:00.000Z' WHERE id = 'conv-2'");
    db.raw.run("UPDATE conversations SET last_message_at = '2026-10-01T09:03:00.000Z' WHERE id = 'conv-1'");
    db.raw.run("UPDATE messages SET deleted_at = '2026-10-01T11:00:00.000Z', content = '' WHERE id = 'm-5'");
    db.raw.run("INSERT INTO conversation_reads (conversation_id, user_id, last_read_at) VALUES ('conv-1', ?, '2026-10-01T09:00:00.000Z')", [STUDENT]);

    let list = await getConversations(db, 'rel-1', STUDENT);
    expect(list.map((c) => [c.id, c.unread])).toEqual([['conv-2', 0], ['conv-1', 2]]);
    expect(list[0].last_message).toMatchObject({ id: 'm-5', content: '', attachment: null, attachment_kind: null });
    expect(list[0].last_message!.deleted_at).toBeTruthy();
    expect((await getConversations(db, 'rel-1', TUTOR)).map((c) => c.unread)).toEqual([0, 1]);

    await w.as(TUTOR).upload('conv-1', 'kind=image', png(3, 3), 'image/png');
    list = await getConversations(db, 'rel-1', STUDENT);
    const conv1 = list.find((c) => c.id === 'conv-1')!;
    expect(conv1.unread).toBe(3);
    expect(conv1.last_message).toMatchObject({ content: '', attachment_kind: 'image', attachment: { kind: 'image', width: 3, height: 3 } });
    expect(JSON.stringify(conv1)).not.toContain('chat-media/conv-1');

    // The inbox and the read endpoint count the same way.
    const inbox = await json<{ messages: Array<{ id: string; preview: string; attachment_kind: string | null }>; conversations: Array<{ conversation_id: string; unread: number }> }>(
      await w.as(STUDENT).call('GET', '/api/me/chat-inbox?since=2026-09-01T00:00:00.000Z'),
    );
    expect(inbox.conversations.map((c) => [c.conversation_id, c.unread])).toEqual([['conv-1', 3]]);
    expect(inbox.messages.map((m) => m.id)).not.toContain('m-5');
    expect(inbox.messages.at(-1)).toMatchObject({ preview: '📷 Photo', attachment_kind: 'image' });
  });
});

describe('chat media helpers', () => {
  it('sniffs audio containers by their magic bytes', () => {
    const pad = (head: number[] | string, n = 16) => {
      const b = new Uint8Array(n);
      b.set(typeof head === 'string' ? [...head].map((c) => c.charCodeAt(0)) : head);
      return b;
    };
    expect(sniffAudio(pad([0x1a, 0x45, 0xdf, 0xa3]))).toBe('audio/webm');
    expect(sniffAudio(pad('OggS'))).toBe('audio/ogg');
    expect(sniffAudio(pad('\0\0\0\x18ftypM4A '))).toBe('audio/mp4');
    expect(sniffAudio(pad('RIFF\0\0\0\0WAVE'))).toBe('audio/wav');
    expect(sniffAudio(pad('ID3'))).toBe('audio/mpeg');
    expect(sniffAudio(pad([0xff, 0xfb]))).toBe('audio/mpeg');
    expect(sniffAudio(pad([0xff, 0xf1]))).toBe('audio/aac');
    expect(sniffAudio(pad('<html>'))).toBeNull();
    expect(() => inspectUpload('image', pad('GIF89a', 40))).toThrow(ChatMediaError);
  });

  it('previews photo / voice messages in notifications', () => {
    const base = {
      id: 'm', conversation_id: 'c', sender_id: TUTOR, created_at: '2026-10-02T09:00:00.000Z', check_status: null, check_feedback: null,
      recording_url: null, reply_to_message_id: null, translation: null, segmentation: null,
      sender: { id: TUTOR, name: 'Minghui', picture_url: null },
    } as MessageWithSender;
    const photo = { ...base, content: '', attachment: { kind: 'image' as const, width: 1, height: 1, bytes: 1, mime: 'image/jpeg' } };
    expect(messagePreviewText(photo)).toBe('📷 Photo');
    expect(chatMessageFcmData(photo, 'rel-1')).toMatchObject({ content: '📷 Photo', attachment_kind: 'image' });
    expect(chatMessageWebPush({ ...photo, content: '看' }, 'rel-1').body).toBe('📷 Photo: 看');
    const voice = { ...base, content: '', attachment: { kind: 'voice' as const, duration_ms: 1, bytes: 1, mime: 'audio/webm', transcript_status: 'pending' as const } };
    expect(messagePreviewText(voice)).toBe('🎤 Voice message');
    expect(messagePreviewText({ ...base, content: '你好' })).toBe('你好');
  });

  it('registers chat-media/ as protected, referenced through messages.attachment', async () => {
    const entry = STORAGE_PREFIXES.find((p) => p.prefix === 'chat-media/')!;
    expect(entry.collectable).toBe(false);
    expect(prefixFor('chat-media/conv-1/m-1.jpg')?.prefix).toBe('chat-media/');
    const db = await createSqliteD1();
    seed(db);
    db.raw.run(`INSERT INTO messages (id, conversation_id, sender_id, content, attachment) VALUES ('m-1', 'conv-1', ?, '', '{"kind":"image","width":1,"height":1,"bytes":1,"mime":"image/jpeg","key":"chat-media/conv-1/m-1.jpg"}')`, [TUTOR]);
    expect((await collectReferences(db)).has('chat-media/conv-1/m-1.jpg')).toBe(true);
  });
});
