/**
 * ChatHub with fake hibernated sockets: broadcast reaches every socket and
 * survives a dead one; ping → pong; typing is forwarded to the other
 * participant's hub only for a member of the conversation, at most every 1.5 s.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ChatHub, TYPING_FORWARD_MS } from '../chat-hub';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import type { Env } from '../../types';

class FakeSocket {
  sent: unknown[] = [];
  dead = false;
  constructor(private attachment: Record<string, unknown>) {}
  deserializeAttachment() {
    return structuredClone(this.attachment);
  }
  serializeAttachment(a: Record<string, unknown>) {
    this.attachment = structuredClone(a);
  }
  send(data: string) {
    if (this.dead) throw new Error('socket closed');
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.dead = true;
  }
}

describe('ChatHub', () => {
  let db: SqliteD1;
  let sockets: FakeSocket[];
  let forwarded: Array<{ user: string; event: unknown }>;
  let hub: ChatHub;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T10:00:00Z'));
    db = await createSqliteD1();
    for (const id of ['tutor-1', 'student-1', 'stranger']) {
      db.raw.run('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', [id, `${id}@x.test`, id, 'student']);
    }
    db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', 'tutor-1', 'student-1', 'tutor', 'active')");
    db.raw.run("INSERT INTO conversations (id, relationship_id) VALUES ('conv-1', 'rel-1')");
    sockets = [new FakeSocket({ connId: 'a', userId: 'student-1' }), new FakeSocket({ connId: 'b', userId: 'student-1' })];
    forwarded = [];
    const ctx = { getWebSockets: () => sockets, acceptWebSocket: () => {}, setWebSocketAutoResponse: () => {} };
    const env = {
      DB: db,
      CHAT_HUB: {
        idFromName: (n: string) => n,
        get: (id: string) => ({ broadcast: async (event: unknown) => { forwarded.push({ user: id, event }); return 1; } }),
      },
    } as unknown as Env;
    hub = new ChatHub(ctx as never, env);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('broadcasts to every socket and survives a dead one', async () => {
    sockets[0].dead = true;
    const sent = await hub.broadcast({ type: 'read', conversation_id: 'conv-1', user_id: 'tutor-1', last_read_at: 'x' });
    expect(sent).toBe(1);
    expect(sockets[1].sent).toEqual([{ type: 'read', conversation_id: 'conv-1', user_id: 'tutor-1', last_read_at: 'x' }]);
  });

  it('answers pings and ignores junk', async () => {
    await hub.webSocketMessage(sockets[0] as never, '{"type":"ping"}');
    await hub.webSocketMessage(sockets[0] as never, 'not json');
    await hub.webSocketMessage(sockets[0] as never, new ArrayBuffer(4));
    expect(sockets[0].sent).toEqual([{ type: 'pong' }]);
  });

  it('forwards typing to the other participant, rate-limited per socket', async () => {
    await hub.webSocketMessage(sockets[0] as never, JSON.stringify({ type: 'typing', conversation_id: 'conv-1' }));
    expect(forwarded).toEqual([{ user: 'tutor-1', event: { type: 'typing', conversation_id: 'conv-1', user_id: 'student-1' } }]);
    await hub.webSocketMessage(sockets[0] as never, JSON.stringify({ type: 'typing', conversation_id: 'conv-1' }));
    expect(forwarded).toHaveLength(1);
    vi.advanceTimersByTime(TYPING_FORWARD_MS + 1);
    await hub.webSocketMessage(sockets[0] as never, JSON.stringify({ type: 'typing', conversation_id: 'conv-1' }));
    expect(forwarded).toHaveLength(2);
  });

  it('never forwards typing for someone outside the conversation', async () => {
    const outsider = new FakeSocket({ connId: 'c', userId: 'stranger' });
    await hub.webSocketMessage(outsider as never, JSON.stringify({ type: 'typing', conversation_id: 'conv-1' }));
    await hub.webSocketMessage(sockets[0] as never, JSON.stringify({ type: 'typing', conversation_id: 'no-such-conv' }));
    expect(forwarded).toEqual([]);
  });
});
