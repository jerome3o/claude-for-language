/**
 * Photo albums in the chat (docs/CHAT.md "Photo albums") against real SQLite with
 * every migration: the album id / index stored per photo, a re-sent photo
 * (same client_id) changing nothing, ONE notification per album (the bell, the
 * FCM preview "📷 3 photos") while the live event still goes out per photo,
 * bad album params refused, "Forward all" keeping the album, and the inbox
 * rows / background inbox showing "📷 3 photos" once.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import chatLive from '../chat-live';
import chatMessages from '../chat-messages';
import { getChatInbox, getChatList } from '../../services/chat/reads';
import { notifyNewChatMessage } from '../../services/chat/notify';
import { parseAlbumParams, AlbumParamError } from '../../services/chat/albums';
import { getMessageById } from '../../services/conversations';
import type { Env, MessageWithSender } from '../../types';

const TUTOR = 'tutor-1';
const STUDENT = 'student-1';

function seed(db: SqliteD1) {
  for (const [id, name] of [[TUTOR, 'Minghui'], [STUDENT, 'Jerome'], ['student-2', 'Anna']]) {
    db.raw.run('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', [id, `${id}@x.test`, name, 'student']);
  }
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'tutor', 'active')", [TUTOR, STUDENT]);
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-2', ?, 'student-2', 'tutor', 'active')", [TUTOR]);
  db.raw.run("INSERT INTO conversations (id, relationship_id, title) VALUES ('conv-1', 'rel-1', 'Homework')");
  db.raw.run("INSERT INTO conversations (id, relationship_id, title) VALUES ('conv-2', 'rel-2', 'Other')");
}

function fakeBucket() {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    bucket: {
      put: async (key: string, value: Uint8Array | ArrayBuffer) => {
        store.set(key, new Uint8Array(value as ArrayBuffer));
        return {};
      },
      get: async (key: string) => {
        const o = store.get(key);
        return o ? { body: o, size: o.length, httpEtag: '"e"', httpMetadata: {}, arrayBuffer: async () => o.buffer } : null;
      },
      delete: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
      },
    },
  };
}

function fakeHubs() {
  const events: Array<{ user: string; event: { type: string; message?: MessageWithSender; album_count?: number } }> = [];
  return {
    events,
    ns: {
      idFromName: (name: string) => name,
      get: (id: string) => ({
        broadcast: async (event: { type: string; message?: MessageWithSender }) => {
          events.push({ user: id, event });
          return 1;
        },
      }),
    },
  };
}

function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(49);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}

function makeWorld(db: SqliteD1) {
  const r2 = fakeBucket();
  const hubs = fakeHubs();
  const env = { DB: db, SESSION_SECRET: 'test-secret', AUDIO_BUCKET: r2.bucket, CHAT_HUB: hubs.ns } as unknown as Env;
  const as = (userId: string) => {
    const app = new Hono<{ Bindings: Env }>();
    app.use('/api/*', async (c, next) => {
      c.set('user', { id: userId } as never);
      await next();
    });
    app.route('/api', chatLive);
    app.route('/api', chatMessages);
    return {
      upload: (conv: string, query: string) =>
        app.request(`/api/conversations/${conv}/media?${query}`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png(400, 300) }, env),
      call: (method: string, path: string, body?: unknown) =>
        app.request(path, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env),
    };
  };
  return { env, r2, hubs, as };
}

const json = async <T = MessageWithSender>(res: Response) => (await res.json()) as T;

describe('chat photo albums', () => {
  let db: SqliteD1;
  let w: ReturnType<typeof makeWorld>;

  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
    w = makeWorld(db);
  });

  async function sendAlbum(as: ReturnType<typeof w.as>, n: number, opts: { caption?: string; album?: string } = {}) {
    const album = opts.album ?? 'al-1';
    const out: MessageWithSender[] = [];
    for (let i = 0; i < n; i++) {
      const caption = i === 0 && opts.caption ? `&caption=${encodeURIComponent(opts.caption)}` : '';
      const res = await as.upload('conv-1', `kind=image&client_id=${album}-p${i}&album_id=${album}&album_index=${i}&album_count=${n}${caption}`);
      expect(res.status).toBe(201);
      out.push(await json(res));
    }
    return out;
  }

  it('stores the album id + index on each photo; the messages carry them', async () => {
    const sent = await sendAlbum(w.as(TUTOR), 3, { caption: '我们的猫' });
    expect(sent.map((m) => [m.album_id, m.album_index, m.content])).toEqual([
      ['al-1', 0, '我们的猫'],
      ['al-1', 1, ''],
      ['al-1', 2, ''],
    ]);
    const page = await json<{ messages: MessageWithSender[] }>(await w.as(STUDENT).call('GET', '/api/conversations/conv-1/messages'));
    expect(page.messages.map((m) => [m.album_id, m.album_index])).toEqual([['al-1', 0], ['al-1', 1], ['al-1', 2]]);
  });

  it('ONE notification per album (the bell), live events per photo with album_count', async () => {
    await sendAlbum(w.as(TUTOR), 3, { caption: '我们的猫' });
    expect(db.rows("SELECT title, message FROM notifications WHERE user_id = ? AND type = 'new_chat_message'", [STUDENT])).toEqual([
      { title: 'New message from Minghui', message: '📷 3 photos: 我们的猫' },
    ]);
    expect(db.rows('SELECT album_index FROM messages WHERE album_notified_at IS NOT NULL')).toEqual([{ album_index: 0 }]);
    const live = w.hubs.events.filter((e) => e.user === STUDENT && e.event.type === 'message');
    expect(live.map((e) => [e.event.message?.album_index, e.event.album_count])).toEqual([[0, 3], [1, 3], [2, 3]]);
  });

  it('a re-sent photo (same client_id) is the same message: nothing stored, notified or broadcast again', async () => {
    const tutor = w.as(TUTOR);
    const [first] = await sendAlbum(tutor, 2);
    const before = w.hubs.events.length;
    const again = await tutor.upload('conv-1', 'kind=image&client_id=al-1-p0&album_id=al-1&album_index=0&album_count=2');
    expect(again.status).toBe(200);
    expect((await json(again)).id).toBe(first.id);
    expect(db.rows('SELECT COUNT(*) AS n FROM messages')).toEqual([{ n: 2 }]);
    expect(w.hubs.events.length).toBe(before);
    expect(db.rows("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?", [STUDENT])).toEqual([{ n: 1 }]);
  });

  it('a second album gets its own notification', async () => {
    const tutor = w.as(TUTOR);
    await sendAlbum(tutor, 2, { album: 'al-a' });
    await sendAlbum(tutor, 2, { album: 'al-b' });
    expect(db.rows('SELECT album_id FROM messages WHERE album_notified_at IS NOT NULL ORDER BY album_id')).toEqual([{ album_id: 'al-a' }, { album_id: 'al-b' }]);
    // The bell merges into "N new messages" as before — once per album.
    expect(db.rows("SELECT title FROM notifications WHERE user_id = ?", [STUDENT])).toEqual([{ title: '2 new messages from Minghui' }]);
  });

  it('the notify step only pushes for the photo that claims the album', async () => {
    const tutor = w.as(TUTOR);
    const sent = await sendAlbum(tutor, 2);
    const pushes: Array<{ body: string }> = [];
    const webPush = (async (_env: unknown, _ids: string[], payload: { body: string }) => {
      pushes.push(payload);
      return 0;
    }) as never;
    // Delivered again (a retry inside the worker): already claimed → live only, no push.
    await notifyNewChatMessage(w.env, sent[1], { id: 'conv-1', relationship_id: 'rel-1' }, { webPush }, { album: { id: 'al-1', index: 1, count: 2 } });
    expect(pushes).toEqual([]);
    // A fresh album's first photo claims and pushes "📷 2 photos".
    db.raw.run("UPDATE messages SET album_notified_at = NULL");
    const msg = (await getMessageById(db, sent[1].id, TUTOR))!;
    await notifyNewChatMessage(w.env, msg, { id: 'conv-1', relationship_id: 'rel-1' }, { webPush }, { album: { id: 'al-1', index: 1, count: 2 } });
    expect(pushes.map((p) => p.body)).toEqual(['📷 2 photos']);
  });

  it('refuses malformed album params', async () => {
    const tutor = w.as(TUTOR);
    for (const q of ['album_id=a&album_index=0&album_count=1', 'album_id=a&album_index=3&album_count=3', 'album_id=a&album_index=0&album_count=11', 'album_id=bad%20id&album_index=0&album_count=2', 'album_id=a&album_count=2']) {
      const res = await tutor.upload('conv-1', `kind=image&${q}`);
      expect(res.status, q).toBe(400);
    }
    expect(() => parseAlbumParams({ album_id: 'x', album_index: '1', album_count: '2' })).not.toThrow();
    expect(parseAlbumParams({})).toBeNull();
    expect(() => parseAlbumParams({ album_id: 'x', album_index: -1, album_count: 2 })).toThrow(AlbumParamError);
  });

  it('Forward all: each photo with one new album id stays one album in the other chat', async () => {
    const tutor = w.as(TUTOR);
    const sent = await sendAlbum(tutor, 3);
    for (const [i, m] of sent.entries()) {
      const res = await tutor.call('POST', `/api/messages/${m.id}/forward`, { conversation_id: 'conv-2', client_id: `fw-${i}`, album_id: 'fw-album', album_index: i, album_count: 3 });
      expect(res.status).toBe(201);
    }
    expect(db.rows("SELECT album_id, album_index, forwarded_from IS NOT NULL AS fwd FROM messages WHERE conversation_id = 'conv-2' ORDER BY album_index")).toEqual([
      { album_id: 'fw-album', album_index: 0, fwd: 1 },
      { album_id: 'fw-album', album_index: 1, fwd: 1 },
      { album_id: 'fw-album', album_index: 2, fwd: 1 },
    ]);
    expect(db.rows("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = 'conv-2' AND album_notified_at IS NOT NULL")).toEqual([{ n: 1 }]);
  });

  it('inbox row and the background inbox say "📷 3 photos" once', async () => {
    await sendAlbum(w.as(TUTOR), 3, { caption: '我们的猫' });
    const list = await getChatList(db, STUDENT);
    expect(list.conversations.find((r) => r.conversation_id === 'conv-1')?.last_message?.preview).toBe('📷 3 photos: 我们的猫');
    const inbox = await getChatInbox(db, STUDENT);
    expect(inbox.messages.map((m) => [m.preview, m.album_id, m.album_count])).toEqual([['📷 3 photos: 我们的猫', 'al-1', 3]]);
    // Unread still counts every photo (they are messages).
    expect(inbox.conversations.find((c) => c.conversation_id === 'conv-1')?.unread).toBe(3);
  });
});
