/**
 * Delivering a chat message / a read (docs/CHAT.md §3) with real SQLite, a fake
 * Google (token exchange + FCM), a fake ChatHub namespace and mocked Web Push /
 * e-mail / ntfy.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { fakeGoogle, makeServiceAccount, UNREGISTERED, SERVER_ERROR } from './fcm-fixture';
import { chatMessageFcmData, notifyChatRead, notifyNewChatMessage } from '../chat/notify';
import { getConversationParticipants } from '../chat/reads';
import { pushToDevices, MAX_DEVICE_FAILURES } from '../push/devices';
import { resetFcmTokenCache } from '../push/fcm';
import type { Env, MessageWithSender } from '../../types';

const TUTOR = 'tutor-1';
const STUDENT = 'student-1';

function fakeHubs() {
  const events: Array<{ user: string; event: Record<string, unknown> }> = [];
  const ns = {
    idFromName: (name: string) => name,
    get: (id: string) => ({
      broadcast: async (event: Record<string, unknown>) => {
        events.push({ user: id, event });
        return 1;
      },
    }),
  };
  return { ns, events };
}

function message(over: Partial<MessageWithSender> = {}): MessageWithSender {
  return {
    id: 'msg-1',
    conversation_id: 'conv-1',
    sender_id: TUTOR,
    content: '明天上课吗？',
    created_at: '2026-10-02T09:00:00.000Z',
    check_status: null,
    check_feedback: null,
    recording_url: null,
    reply_to_message_id: null,
    translation: null,
    segmentation: null,
    client_id: null,
    sender: { id: TUTOR, name: 'Minghui', picture_url: 'https://img.example/m.jpg' },
    reply_to: null,
    reactions: [],
    has_discussion: false,
    ...over,
  };
}

describe('chat notifications', () => {
  let db: SqliteD1;
  let saJson: string;

  beforeEach(async () => {
    resetFcmTokenCache();
    saJson ??= (await makeServiceAccount()).json;
    db = await createSqliteD1();
    for (const [id, name] of [[TUTOR, 'Minghui'], [STUDENT, 'Jerome']]) {
      db.raw.run('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', [id, `${id}@x.test`, name, 'student']);
    }
    db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'tutor', 'active')", [TUTOR, STUDENT]);
    db.raw.run("INSERT INTO conversations (id, relationship_id) VALUES ('conv-1', 'rel-1')");
    db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-ai', ?, 'claude-ai', 'student', 'active')", [STUDENT]);
    db.raw.run("INSERT INTO conversations (id, relationship_id, is_ai_conversation) VALUES ('conv-ai', 'rel-ai', 1)");
    const token = (id: string, user: string, tok: string) =>
      db.raw.run('INSERT INTO device_push_tokens (id, user_id, token) VALUES (?, ?, ?)', [id, user, tok]);
    token('d-student', STUDENT, 'student-phone');
    token('d-student-dead', STUDENT, 'student-old-phone');
    token('d-tutor', TUTOR, 'tutor-phone');
  });

  function env(hubs = fakeHubs()): Env {
    return { DB: db, CHAT_HUB: hubs.ns, FCM_SERVICE_ACCOUNT_JSON: saJson, SENDGRID_API_KEY: 'sg', NTFY_TOPIC: 'topic', SESSION_SECRET: 'test-secret' } as unknown as Env;
  }

  it('a new message: live to both, FCM + Web Push to the recipient only, and the old channels as before', async () => {
    const hubs = fakeHubs();
    const google = fakeGoogle({ 'student-old-phone': UNREGISTERED });
    const webPush = vi.fn(async () => ({ sent: 1, failed: 0, removed: 0 }));
    const email = vi.fn(async () => true);
    const ntfy = vi.fn(async () => {});
    const msg = message();
    await notifyNewChatMessage(env(hubs), msg, { id: 'conv-1', relationship_id: 'rel-1' }, { fetcher: google.fetcher, webPush, email, ntfy });

    // 1. Live.
    expect(hubs.events.map((e) => e.user).sort()).toEqual([STUDENT, TUTOR]);
    expect(hubs.events[0].event).toEqual({ type: 'message', message: msg, relationship_id: 'rel-1' });

    // 2. FCM: only the student's devices; the sender's phone never gets chat_message.
    const sends = google.sends();
    expect(sends.map((s) => s.json.message.token).sort()).toEqual(['student-old-phone', 'student-phone']);
    const good = sends.find((s) => s.json.message.token === 'student-phone')!;
    expect(good.json.message.android).toEqual({ priority: 'HIGH', ttl: '86400s', collapse_key: 'conv-1' });
    expect(good.json.message.data).toEqual({
      type: 'chat_message',
      conversation_id: 'conv-1',
      relationship_id: 'rel-1',
      message_id: 'msg-1',
      sender_id: TUTOR,
      sender_name: 'Minghui',
      sender_picture_url: 'https://img.example/m.jpg',
      content: '明天上课吗？',
      attachment_kind: '',
      created_at: '2026-10-02T09:00:00.000Z',
      url: '/connections/rel-1/chat/conv-1',
    });
    // The uninstalled phone's token is gone; the good one recorded a success.
    expect(db.rows('SELECT id, failure_count, last_success_at IS NOT NULL AS ok FROM device_push_tokens ORDER BY id')).toEqual([
      { id: 'd-student', failure_count: 0, ok: 1 },
      { id: 'd-tutor', failure_count: 0, ok: 0 },
    ]);

    // 3. Web Push.
    expect(webPush).toHaveBeenCalledTimes(1);
    const [, users, payload, opts] = webPush.mock.calls[0] as unknown as [Env, string[], Record<string, unknown>, Record<string, unknown>];
    expect(users).toEqual([STUDENT]);
    expect(payload).toEqual({
      type: 'chat_message',
      title: 'Minghui',
      body: '明天上课吗？',
      url: '/connections/rel-1/chat/conv-1',
      tag: 'chat-conv-1',
      conversation_id: 'conv-1',
      relationship_id: 'rel-1',
    });
    expect(opts).toMatchObject({ ttl: 86400, urgency: 'high' });

    // 4. Unchanged: e-mail to the student, the bell row, ntfy.
    expect(email).toHaveBeenCalledWith('sg', expect.objectContaining({ recipientEmail: `${STUDENT}@x.test`, senderName: 'Minghui', conversationId: 'conv-1', relationshipId: 'rel-1' }));
    expect(db.rows("SELECT user_id, title, message FROM notifications WHERE type = 'new_chat_message'")).toEqual([
      { user_id: STUDENT, title: 'New message from Minghui', message: '明天上课吗？' },
    ]);
    expect(ntfy).toHaveBeenCalledWith('topic', 'Minghui', '明天上课吗？');

    // A second message folds into the same bell row.
    await notifyNewChatMessage(env(), message({ id: 'msg-2' }), { id: 'conv-1', relationship_id: 'rel-1' }, { fetcher: google.fetcher, webPush, email, ntfy });
    expect(db.rows("SELECT title FROM notifications WHERE type = 'new_chat_message'")).toEqual([{ title: '2 new messages from Minghui' }]);
  });

  it('one channel failing never stops the others', async () => {
    const hubs = fakeHubs();
    const google = fakeGoogle();
    const webPush = vi.fn(async () => { throw new Error('push down'); });
    await notifyNewChatMessage(env(hubs), message(), { id: 'conv-1', relationship_id: 'rel-1' }, { fetcher: google.fetcher, webPush, email: vi.fn(async () => { throw new Error('mail down'); }), ntfy: vi.fn(async () => {}) });
    expect(hubs.events).toHaveLength(2);
    expect(google.sends()).toHaveLength(2);
    expect(db.rows("SELECT COUNT(*) AS n FROM notifications")).toEqual([{ n: 1 }]);
  });

  it('a long message is cut for FCM', () => {
    const data = chatMessageFcmData(message({ content: '字'.repeat(1500) }), 'rel-1');
    expect(data.content).toHaveLength(1000);
  });

  it('a message to Claude (role-play chat) goes to nobody but the sender’s other devices', async () => {
    const hubs = fakeHubs();
    const google = fakeGoogle();
    const webPush = vi.fn(async () => ({ sent: 0, failed: 0, removed: 0 }));
    const msg = message({ conversation_id: 'conv-ai', sender_id: STUDENT, sender: { id: STUDENT, name: 'Jerome', picture_url: null } });
    await notifyNewChatMessage(env(hubs), msg, { id: 'conv-ai', relationship_id: 'rel-ai' }, { fetcher: google.fetcher, webPush, email: vi.fn(async () => true), ntfy: vi.fn(async () => {}) });
    expect(hubs.events.map((e) => e.user)).toEqual([STUDENT]);
    expect(google.sends()).toHaveLength(0);
    expect(webPush).not.toHaveBeenCalled();
  });

  it('a read: chat_read to MY native devices, a read event to me and the other person', async () => {
    const hubs = fakeHubs();
    const google = fakeGoogle({ 'student-old-phone': UNREGISTERED });
    const participants = (await getConversationParticipants(db, 'conv-1'))!;
    await notifyChatRead(env(hubs), STUDENT, participants, '2026-10-02T09:00:00.000Z', { fetcher: google.fetcher });
    const sends = google.sends();
    expect(sends.map((s) => s.json.message.token).sort()).toEqual(['student-old-phone', 'student-phone']);
    expect(sends[0].json.message.data).toEqual({ type: 'chat_read', conversation_id: 'conv-1', last_read_at: '2026-10-02T09:00:00.000Z' });
    const event = { type: 'read', conversation_id: 'conv-1', user_id: STUDENT, last_read_at: '2026-10-02T09:00:00.000Z' };
    expect(hubs.events).toEqual([{ user: STUDENT, event }, { user: TUTOR, event }]);
  });

  it('pushToDevices: failures count up and drop a token after five; without FCM it sends nothing', async () => {
    const google = fakeGoogle({ 'tutor-phone': SERVER_ERROR });
    for (let i = 1; i < MAX_DEVICE_FAILURES; i++) {
      const r = await pushToDevices(env(), [TUTOR], { type: 'x' }, {}, google.fetcher);
      expect(r).toEqual({ sent: 0, failed: 1, removed: 0 });
      expect(db.rows("SELECT failure_count FROM device_push_tokens WHERE id = 'd-tutor'")).toEqual([{ failure_count: i }]);
    }
    expect(await pushToDevices(env(), [TUTOR], { type: 'x' }, {}, google.fetcher)).toEqual({ sent: 0, failed: 0, removed: 1 });
    expect(db.rows("SELECT id FROM device_push_tokens WHERE id = 'd-tutor'")).toEqual([]);

    // Our credentials failing is not the device's fault.
    const offline = (async () => { throw new Error('offline'); }) as typeof fetch;
    expect(await pushToDevices(env(), [STUDENT], { type: 'x' }, {}, offline)).toEqual({ sent: 0, failed: 2, removed: 0 });
    expect(db.rows('SELECT failure_count FROM device_push_tokens WHERE user_id = ?', [STUDENT])).toEqual([{ failure_count: 0 }, { failure_count: 0 }]);

    const none = fakeGoogle();
    const noFcm = { DB: db } as unknown as Env;
    expect(await pushToDevices(noFcm, [STUDENT], { type: 'x' }, {}, none.fetcher)).toEqual({ sent: 0, failed: 0, removed: 0 });
    expect(none.calls).toHaveLength(0);
  });
});
