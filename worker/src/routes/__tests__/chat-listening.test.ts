/**
 * Listening mode (docs/CHAT.md "Listening mode") against real SQLite with every
 * migration: the per-conversation setting and the account default, member
 * checks, validation, and notification previews that never spoil a hidden message.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import chatListening from '../chat-listening';
import { listeningFor, notificationPreviewFor, parseListeningBody } from '../../services/chat/listening';
import { notifyNewChatMessage } from '../../services/chat/notify';
import { LISTENING_PREVIEW } from '@shared/chats/listening';
import type { Env, MessageWithSender } from '../../types';

const TUTOR = 'tutor-1';
const STUDENT = 'student-1';

function seed(db: SqliteD1) {
  for (const [id, name] of [[TUTOR, 'Minghui'], [STUDENT, 'Jerome'], ['stranger', 'Nobody']]) {
    db.raw.run('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', [id, `${id}@x.test`, name, 'student']);
  }
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'tutor', 'active')", [TUTOR, STUDENT]);
  db.raw.run("INSERT INTO conversations (id, relationship_id) VALUES ('conv-1', 'rel-1')");
  db.raw.run("INSERT INTO conversations (id, relationship_id) VALUES ('conv-2', 'rel-1')");
}

function message(over: Partial<MessageWithSender> = {}): MessageWithSender {
  return {
    id: 'msg-1', conversation_id: 'conv-1', sender_id: TUTOR, content: '明天上课吗？', created_at: '2026-10-02T09:00:00.000Z',
    check_status: null, check_feedback: null, recording_url: null, reply_to_message_id: null, translation: null, segmentation: null,
    client_id: null, sender: { id: TUTOR, name: 'Minghui', picture_url: null }, reply_to: null, reactions: [], has_discussion: false,
    ...over,
  } as MessageWithSender;
}

describe('listening mode', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
  });

  function call(userId: string, method: string, path: string, body?: unknown) {
    const app = new Hono<{ Bindings: Env }>();
    app.use('/api/*', async (c, next) => {
      c.set('user', { id: userId } as never);
      await next();
    });
    app.route('/api', chatListening);
    return app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, { DB: db } as unknown as Env);
  }

  it('stores a conversation setting and the default, per user', async () => {
    expect(await (await call(STUDENT, 'GET', '/api/me/chat-listening')).json()).toEqual({ default_on: false, conversations: [] });

    const put = await call(STUDENT, 'PUT', '/api/conversations/conv-1/listening', { on: true, since: '2026-10-02T08:00:00.000Z' });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ conversation_id: 'conv-1', on: true, since: '2026-10-02T08:00:00.000Z' });
    // Upsert: switching off keeps one row.
    await call(STUDENT, 'PUT', '/api/conversations/conv-1/listening', { on: false });
    expect((await call(STUDENT, 'PUT', '/api/profile/chat-listening', { on: true })).status).toBe(200);

    const state = (await (await call(STUDENT, 'GET', '/api/me/chat-listening')).json()) as { default_on: boolean; conversations: unknown[] };
    expect(state.default_on).toBe(true);
    expect(state.conversations).toEqual([expect.objectContaining({ conversation_id: 'conv-1', on: false, since: null })]);
    // The tutor's own state is untouched.
    expect(await (await call(TUTOR, 'GET', '/api/me/chat-listening')).json()).toEqual({ default_on: false, conversations: [] });

    expect(await listeningFor(db, STUDENT, 'conv-1')).toEqual({ on: false, since: null });
    expect(await listeningFor(db, STUDENT, 'conv-2')).toEqual({ on: true, since: null }); // the default
    expect(await listeningFor(db, TUTOR, 'conv-2')).toEqual({ on: false, since: null });
  });

  it('refuses strangers, unknown conversations and bad bodies', async () => {
    expect((await call('stranger', 'PUT', '/api/conversations/conv-1/listening', { on: true })).status).toBe(403);
    expect((await call(STUDENT, 'PUT', '/api/conversations/nope/listening', { on: true })).status).toBe(404);
    expect((await call(STUDENT, 'PUT', '/api/conversations/conv-1/listening', { on: 'yes' })).status).toBe(400);
    expect((await call(STUDENT, 'PUT', '/api/conversations/conv-1/listening', { on: true, since: 'yesterday' })).status).toBe(400);
    expect((await call(STUDENT, 'PUT', '/api/profile/chat-listening', {})).status).toBe(400);
    expect(parseListeningBody({ on: true, since: '2026-10-02T08:00:00Z' })).toEqual({ on: true, since: '2026-10-02T08:00:00Z' });
  });

  it('notification previews: "🎧 New message" for a hidden message, the text otherwise', async () => {
    const msg = message();
    expect(await notificationPreviewFor(db, STUDENT, msg, msg.content)).toBe(msg.content);
    await call(STUDENT, 'PUT', '/api/conversations/conv-1/listening', { on: true, since: '2026-10-01T00:00:00.000Z' });
    expect(await notificationPreviewFor(db, STUDENT, msg, msg.content)).toBe(LISTENING_PREVIEW);
    // Photos, English and my own messages stay as they are.
    expect(await notificationPreviewFor(db, STUDENT, message({ attachment: { kind: 'image' } as never }), '📷 Photo: 看')).toBe('📷 Photo: 看');
    expect(await notificationPreviewFor(db, STUDENT, message({ content: 'see you at 5' }), 'see you at 5')).toBe('see you at 5');
    expect(await notificationPreviewFor(db, TUTOR, message({ sender_id: STUDENT }), '明天上课吗？')).toBe('明天上课吗？');

    // Every channel of the recipient follows it.
    const webPush = vi.fn(async () => ({ sent: 1, failed: 0, removed: 0 }));
    const ntfy = vi.fn(async () => {});
    const hubs = { idFromName: (n: string) => n, get: () => ({ broadcast: async () => 1 }) };
    await notifyNewChatMessage({ DB: db, CHAT_HUB: hubs } as unknown as Env, msg, { id: 'conv-1', relationship_id: 'rel-1' }, { webPush, ntfy });
    const [, , payload] = webPush.mock.calls[0] as unknown as [Env, string[], { body: string }];
    expect(payload.body).toBe(LISTENING_PREVIEW);
    expect(ntfy).toHaveBeenCalledWith(undefined, 'Minghui', LISTENING_PREVIEW);
    expect(db.rows("SELECT message FROM notifications WHERE type = 'new_chat_message'")).toEqual([{ message: LISTENING_PREVIEW }]);
  });
});

// ---------- Pre-generated read-aloud clips ----------

import { ensureMessageClip, messageClipKey, messageVoice, pregenerateMessageClip, type MessageTts } from '../../services/chat/message-audio';

function fakeBucket() {
  const store = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  return {
    store,
    bucket: {
      head: async (key: string) => (store.has(key) ? {} : null),
      put: async (key: string, value: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) => {
        store.set(key, { bytes: new Uint8Array(value), contentType: opts?.httpMetadata?.contentType });
        return {};
      },
      get: async (key: string) => {
        const o = store.get(key);
        return o ? { body: o.bytes, httpMetadata: { contentType: o.contentType } } : null;
      },
    },
  };
}

describe('message clips', () => {
  let db: SqliteD1;
  let r2: ReturnType<typeof fakeBucket>;
  let tts: ReturnType<typeof vi.fn> & MessageTts;
  const env = () => ({ DB: db, AUDIO_BUCKET: r2.bucket } as unknown as Env);
  const insert = (id: string, content: string, conv = 'conv-1') =>
    db.raw.run("INSERT INTO messages (id, conversation_id, sender_id, content, created_at) VALUES (?, ?, ?, ?, '2026-10-02T09:00:00.000Z')", [id, conv, TUTOR, content]);

  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
    db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-ai', ?, 'claude-ai', 'student', 'active')", [STUDENT]);
    db.raw.run("INSERT INTO conversations (id, relationship_id, is_ai_conversation) VALUES ('conv-ai', 'rel-ai', 1)");
    r2 = fakeBucket();
    tts = vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'audio/mpeg' })) as never;
  });

  it('a Chinese text message gets one clip, stored in R2 and on the row; an edit makes a new one', async () => {
    insert('m-1', '明天见');
    await pregenerateMessageClip(env(), { id: 'm-1', conversation_id: 'conv-1', content: '明天见' }, tts);
    const [{ audio_key }] = db.rows<{ audio_key: string }>("SELECT audio_key FROM messages WHERE id = 'm-1'");
    expect(audio_key).toMatch(/^chat-tts\/conv-1\/m-1-[0-9a-f]{16}\.mp3$/);
    expect(r2.store.get(audio_key)?.contentType).toBe('audio/mpeg');
    expect(tts).toHaveBeenCalledWith(expect.anything(), '明天见', { voiceId: expect.any(String), speed: expect.any(Number) });

    // Again: already there, no second TTS call.
    expect(await ensureMessageClip(env(), { id: 'm-1', conversation_id: 'conv-1', content: '明天见' }, tts)).toBe(audio_key);
    expect(tts).toHaveBeenCalledTimes(1);

    // Edited text → a different key.
    db.raw.run("UPDATE messages SET content = '后天见' WHERE id = 'm-1'");
    await pregenerateMessageClip(env(), { id: 'm-1', conversation_id: 'conv-1', content: '后天见' }, tts);
    const [{ audio_key: edited }] = db.rows<{ audio_key: string }>("SELECT audio_key FROM messages WHERE id = 'm-1'");
    expect(edited).not.toBe(audio_key);
    expect(tts).toHaveBeenCalledTimes(2);
  });

  it('skips English, photos, deleted messages, Claude chats; a failing TTS never throws', async () => {
    await pregenerateMessageClip(env(), { id: 'x', conversation_id: 'conv-1', content: 'see you' }, tts);
    await pregenerateMessageClip(env(), { id: 'x', conversation_id: 'conv-1', content: '看', attachment: { kind: 'image' } }, tts);
    await pregenerateMessageClip(env(), { id: 'x', conversation_id: 'conv-1', content: '看', deleted_at: 'now' }, tts);
    await pregenerateMessageClip(env(), { id: 'x', conversation_id: 'conv-ai', content: '欢迎' }, tts);
    expect(tts).not.toHaveBeenCalled();
    const failing = vi.fn(async () => { throw new Error('MiniMax down'); }) as never;
    await expect(pregenerateMessageClip(env(), { id: 'm-2', conversation_id: 'conv-1', content: '你好' }, failing)).resolves.toBeUndefined();
  });

  it('GET /api/messages/:id/audio serves the clip to members only', async () => {
    insert('m-3', '你好');
    const key = await messageClipKey({ id: 'm-3', conversation_id: 'conv-1', content: '你好' }, await messageVoice(env(), 'conv-1'));
    await r2.bucket.put(key, new Uint8Array([9, 9]), { httpMetadata: { contentType: 'audio/mpeg' } });
    const app = (userId: string) => {
      const a = new Hono<{ Bindings: Env }>();
      a.use('/api/*', async (c, next) => {
        c.set('user', { id: userId } as never);
        await next();
      });
      a.route('/api', chatListening);
      return a;
    };
    const res = await app(STUDENT).request('/api/messages/m-3/audio', {}, env());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
    expect(db.rows("SELECT audio_key FROM messages WHERE id = 'm-3'")).toEqual([{ audio_key: key }]);
    expect((await app('stranger').request('/api/messages/m-3/audio', {}, env())).status).toBe(403);
    expect((await app(STUDENT).request('/api/messages/nope/audio', {}, env())).status).toBe(404);
  });
});
