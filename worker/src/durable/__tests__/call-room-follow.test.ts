import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CallRoom } from '../call-room';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import { type ServerMessage } from '@shared/calls';

// Node 20 (CI) has no global WebSocket; the room only reads WebSocket.OPEN.
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  (globalThis as { WebSocket?: unknown }).WebSocket = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 };
}

const TUTOR = 'tutor-1';
const STUDENT = 'student-1';
const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

class FakeWs {
  readyState = 1;
  sent: ServerMessage[] = [];
  private att: unknown;
  constructor(att: unknown) {
    this.att = clone(att);
  }
  serializeAttachment(a: unknown) {
    this.att = clone(a);
  }
  deserializeAttachment() {
    return clone(this.att);
  }
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  close() {
    this.readyState = 3;
  }
  of<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.sent.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[];
  }
}

function fakeCtx() {
  const store = new Map<string, unknown>();
  const sockets: FakeWs[] = [];
  return {
    store,
    sockets,
    getWebSockets: () => sockets,
    acceptWebSocket: () => {},
    storage: {
      get: async (k: string) => clone(store.get(k)),
      put: async (k: string | Record<string, unknown>, v?: unknown) => {
        if (typeof k === 'string') store.set(k, clone(v));
        else for (const [kk, vv] of Object.entries(k)) store.set(kk, clone(vv));
      },
      delete: async (k: string) => store.delete(k),
      setAlarm: async () => {},
      deleteAlarm: async () => {},
    },
  };
}

let db: SqliteD1;

function exec(sql: string, ...params: Array<string | number | null>) {
  db.raw.run(sql, params);
}

function newCall(id: string, rel: string | null, by = TUTOR) {
  exec("INSERT INTO calls (id, relationship_id, created_by, status) VALUES (?, ?, ?, 'live')", id, rel, by);
}

/** The room's private steps the tests drive directly. */
interface Room {
  loadPages(): Promise<void>;
  persistNow(): Promise<void>;
  snapshot(): Promise<void>;
  webSocketMessage(ws: unknown, raw: string): Promise<void>;
}

async function openRoom(callId: string) {
  const ctx = fakeCtx();
  ctx.store.set('callId', callId);
  const room = new CallRoom(ctx as never, { DB: db } as never) as unknown as Room;
  await room.loadPages();
  const join = (userId: string, clientId: string, screen = false) => {
    const ws = new FakeWs({ clientId, userId, name: userId, picture: null, state: { mic: true, cam: true, screen, recording: false }, instance: clientId, seen: Date.now() });
    ctx.sockets.push(ws);
    return ws;
  };
  const say = (ws: FakeWs, msg: unknown) => room.webSocketMessage(ws as never, JSON.stringify(msg));
  return { room, ctx, join, say };
}


beforeEach(async () => {
  db = await createSqliteD1();
  exec("INSERT INTO users (id, email, name) VALUES (?, 't@example.com', 'Tutor')", TUTOR);
  exec("INSERT INTO users (id, email, name) VALUES (?, 's@example.com', 'Student')", STUDENT);
  exec("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'student', 'active')", STUDENT, TUTOR);
  exec("INSERT INTO call_lessons (id, relationship_id, created_by, started_at) VALUES ('les-1', 'rel-1', ?, 1)", TUTOR);
  exec("INSERT INTO calls (id, relationship_id, created_by, status, lesson_id) VALUES ('c1', 'rel-1', ?, 'live', 'les-1')", STUDENT);
});

afterEach(() => vi.useRealTimers());

describe('CallRoom round 5: the tutor stops the student’s screen share', () => {
  it('only the relationship’s tutor can; the student’s device is told and everyone hears the share ended', async () => {
    const { ctx, join, say } = await openRoom('c1');
    const t = join(TUTOR, 'ct', true);
    const s = join(STUDENT, 'cs', true);
    // The student can't stop the tutor's share.
    await say(s, { type: 'stop_share' });
    expect(t.of('share_stopped')).toHaveLength(0);
    expect(s.of('error').at(-1)?.message).toMatch(/Only the tutor/);
    expect((t.deserializeAttachment() as { state: { screen: boolean } }).state.screen).toBe(true);
    // The tutor can stop the student's.
    await say(t, { type: 'stop_share' });
    expect(s.of('share_stopped')).toEqual([{ type: 'share_stopped', by: TUTOR, name: TUTOR }]);
    expect(t.of('peer_state').at(-1)).toEqual({ type: 'peer_state', client_id: 'cs', state: { mic: true, cam: true, screen: false, recording: false } });
    expect((s.deserializeAttachment() as { state: { screen: boolean } }).state.screen).toBe(false);
    // Her own share is untouched.
    expect((t.deserializeAttachment() as { state: { screen: boolean } }).state.screen).toBe(true);
    expect(ctx.sockets.length).toBe(2);
  });

  it('nobody leads in a solo call', async () => {
    exec("INSERT INTO calls (id, relationship_id, created_by, status) VALUES ('solo', NULL, ?, 'live')", TUTOR);
    const { join, say } = await openRoom('solo');
    const t = join(TUTOR, 'ct', true);
    await say(t, { type: 'stop_share' }); // nobody else is sharing
    expect(t.of('share_stopped')).toHaveLength(0);
    await say(t, { type: 'show', view: { kind: 'draw' } });
    expect(t.of('shown')).toHaveLength(0);
    expect(t.of('error').at(-1)?.message).toMatch(/Only the tutor/);
  });
});

describe('CallRoom round 5: Show for student', () => {
  it('keeps the latest show, follows her page turns as the same show, and gives it back on a reconnect', async () => {
    const { room, ctx, join, say } = await openRoom('c1');
    const t = join(TUTOR, 'ct');
    const s = join(STUDENT, 'cs');
    // The student can't lead.
    await say(s, { type: 'show', view: { kind: 'material' } });
    expect(ctx.store.get('shown')).toBeUndefined();
    expect(t.of('shown')).toHaveLength(0);
    // The tutor shows a board page: both hear it.
    await say(t, { type: 'show', view: { kind: 'text', page: 'p1' } });
    const first = s.of('shown').at(-1)!.shown!;
    expect(first).toMatchObject({ v: 1, by: TUTOR, name: TUTOR, view: { kind: 'text', page: 'p1' } });
    expect(t.of('shown').at(-1)!.shown).toEqual(first);
    // Her page turn follows: same show, v + 1.
    await say(t, { type: 'show', view: { kind: 'text', page: 'p2' }, follow: true });
    const turned = s.of('shown').at(-1)!.shown!;
    expect(turned.id).toBe(first.id);
    expect(turned.v).toBe(2);
    expect(turned.view).toEqual({ kind: 'text', page: 'p2' });
    // Garbage is refused; the button pressed again is a NEW show.
    await say(t, { type: 'show', view: { kind: 'nope' } });
    expect(s.of('shown')).toHaveLength(2);
    await say(t, { type: 'show', view: { kind: 'text', page: 'p2' } });
    expect(s.of('shown').at(-1)!.shown!.id).not.toBe(first.id);
    await say(t, { type: 'show', view: { kind: 'material' } });
    const material = s.of('shown').at(-1)!.shown!;
    // The student's page reloads: welcome carries the show and who the tutor is.
    const pair = [new FakeWs(null), new FakeWs(null)];
    (globalThis as { WebSocketPair?: unknown }).WebSocketPair = function WebSocketPair() {
      return { 0: pair[0], 1: pair[1] };
    };
    await (room as unknown as { fetch(r: Request): Promise<Response> })
      .fetch(new Request('https://x/ws', { headers: { Upgrade: 'websocket', 'X-Call-Id': 'c1', 'X-User-Id': STUDENT, 'X-Instance': 'reload' } }))
      .catch(() => null); // Node can't build a 101 response; the welcome is already sent
    const welcome = pair[1].of('welcome')[0];
    expect(welcome.tutor_id).toBe(TUTOR);
    expect(welcome.shown).toEqual(material);
    delete (globalThis as { WebSocketPair?: unknown }).WebSocketPair;
    // Stop showing.
    await say(t, { type: 'show', view: null });
    expect(s.of('shown').at(-1)!.shown).toBeNull();
    expect(ctx.store.get('shown')).toBeNull();
  });
});
