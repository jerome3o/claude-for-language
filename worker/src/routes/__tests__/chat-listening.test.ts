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

// ---------- Pre-generated read-aloud clips (on the one chat TTS path) ----------

import { chatClipsFor, pregenerateMessageClip, readAloudFor } from '../../services/chat/message-audio';
import { chatReadAloudVoice, CHAT_READ_ALOUD_SPEED } from '@shared/chats/voice';
import { ttsCacheKey } from '../../services/tts-cache';

describe('message clips', () => {
  let db: SqliteD1;
  let make: ReturnType<typeof vi.fn>;
  const env = () => ({ DB: db } as unknown as Env);
  const insert = (id: string, content: string, sender = TUTOR, conv = 'conv-1', at = '2026-10-02T09:00:00.000Z', extra = '') =>
    db.raw.run(`INSERT INTO messages (id, conversation_id, sender_id, content, created_at${extra ? ', attachment' : ''}) VALUES (?, ?, ?, ?, ?${extra ? ', ?' : ''})`,
      extra ? [id, conv, sender, content, at, extra] : [id, conv, sender, content, at]);

  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
    db.raw.run("UPDATE users SET voice_gender = 'female' WHERE id = ?", [TUTOR]);
    db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-ai', ?, 'claude-ai', 'student', 'active')", [STUDENT]);
    db.raw.run("INSERT INTO conversations (id, relationship_id, is_ai_conversation) VALUES ('conv-ai', 'rel-ai', 1)");
    make = vi.fn(async () => null);
  });

  it('warms the shared TTS cache in the voice the listener hears (sender gender × listener voices)', async () => {
    await pregenerateMessageClip(env(), { id: 'm-1', conversation_id: 'conv-1', sender_id: TUTOR, content: '明天见' }, make as never);
    const expected = { voiceId: chatReadAloudVoice({ senderGender: 'female', enabled: null }), speed: CHAT_READ_ALOUD_SPEED };
    expect(make).toHaveBeenCalledWith(expect.anything(), '明天见', expected);
    expect(readAloudFor('female', null)).toEqual(expected);
    // The cache key is the read-aloud one: same text + voice + speed → same clip for Read aloud and the tap.
    expect(await ttsCacheKey('明天见', expected.voiceId, expected.speed)).toMatch(/^tts-cache\/v2\//);
  });

  it('skips English, photos, deleted messages, Claude chats; a failing TTS never throws', async () => {
    const base = { id: 'x', conversation_id: 'conv-1', sender_id: TUTOR };
    await pregenerateMessageClip(env(), { ...base, content: 'see you' }, make as never);
    await pregenerateMessageClip(env(), { ...base, content: '看', attachment: { kind: 'image' } }, make as never);
    await pregenerateMessageClip(env(), { ...base, content: '看', deleted_at: 'now' }, make as never);
    await pregenerateMessageClip(env(), { ...base, conversation_id: 'conv-ai', sender_id: STUDENT, content: '欢迎' }, make as never);
    expect(make).not.toHaveBeenCalled();
    const failing = vi.fn(async () => { throw new Error('MiniMax down'); });
    await expect(pregenerateMessageClip(env(), { ...base, content: '你好' }, failing as never)).resolves.toBeUndefined();
  });

  it('GET /api/me/chat-clips lists the other person’s newest Chinese text messages with my voice', async () => {
    insert('a', '你好', TUTOR, 'conv-1', '2026-10-02T09:00:00.000Z');
    insert('b', 'hello', TUTOR, 'conv-1', '2026-10-02T09:01:00.000Z');
    insert('c', '我很好', STUDENT, 'conv-1', '2026-10-02T09:02:00.000Z');
    insert('d', '看', TUTOR, 'conv-1', '2026-10-02T09:03:00.000Z', JSON.stringify({ kind: 'image', key: 'k', bytes: 1, mime: 'image/jpeg' }));
    insert('e', '明天见', TUTOR, 'conv-2', '2026-10-02T09:04:00.000Z');
    const clips = await chatClipsFor(env(), STUDENT);
    const voice = chatReadAloudVoice({ senderGender: 'female', enabled: null });
    expect(clips.sort((x, y) => x.message_id.localeCompare(y.message_id))).toEqual([
      { message_id: 'a', conversation_id: 'conv-1', text: '你好', voice_id: voice, speed: CHAT_READ_ALOUD_SPEED },
      { message_id: 'e', conversation_id: 'conv-2', text: '明天见', voice_id: voice, speed: CHAT_READ_ALOUD_SPEED },
    ]);
    expect((await chatClipsFor(env(), STUDENT, 1)).length).toBe(2);
    expect(await chatClipsFor(env(), 'stranger')).toEqual([]);

    const app = new Hono<{ Bindings: Env }>();
    app.use('/api/*', async (c, next) => {
      c.set('user', { id: TUTOR } as never);
      await next();
    });
    app.route('/api', chatListening);
    const res = await app.request('/api/me/chat-clips', {}, env());
    expect(((await res.json()) as { clips: Array<{ message_id: string }> }).clips.map((c) => c.message_id)).toEqual(['c']);
  });
});
