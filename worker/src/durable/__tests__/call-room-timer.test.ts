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

describe('CallRoom: the call timer', () => {
  it('the tutor sets and runs it; the student sees it and can’t touch it; a reconnect gets it in welcome', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    const { room, ctx, join, say } = await openRoom('c1');
    const t = join(TUTOR, 'ct');
    const s = join(STUDENT, 'cs');
    // The student can't set one.
    await say(s, { type: 'timer', action: { kind: 'set', mode: 'countdown', duration_ms: 60_000, start: true } });
    expect(t.of('timer')).toHaveLength(0);
    expect(s.of('error').at(-1)?.message).toMatch(/Only the tutor/);
    // The tutor sets a 5-minute countdown, running.
    await say(t, { type: 'timer', action: { kind: 'set', mode: 'countdown', duration_ms: 300_000, start: true } });
    const set = s.of('timer').at(-1)!;
    expect(set.server_time).toBe(1_000_000);
    expect(set.timer).toMatchObject({ mode: 'countdown', duration_ms: 300_000, running: true, started_at: 1_000_000, elapsed_ms: 0, by: TUTOR });
    expect(t.of('timer')).toHaveLength(1); // the sender hears it too
    // Pause 61 s later; the student's pause is refused.
    vi.setSystemTime(1_061_000);
    await say(s, { type: 'timer', action: { kind: 'pause' } });
    expect(s.of('timer')).toHaveLength(1);
    await say(t, { type: 'timer', action: { kind: 'pause' } });
    expect(s.of('timer').at(-1)!.timer).toMatchObject({ running: false, started_at: null, elapsed_ms: 61_000 });
    // Pausing a paused timer says nothing; garbage is ignored.
    await say(t, { type: 'timer', action: { kind: 'pause' } });
    await say(t, { type: 'timer', action: { kind: 'set', mode: 'countdown', duration_ms: 'soon' } });
    expect(s.of('timer')).toHaveLength(2);
    // The student's page reloads: welcome carries it.
    const pair = [new FakeWs(null), new FakeWs(null)];
    (globalThis as { WebSocketPair?: unknown }).WebSocketPair = function WebSocketPair() {
      return { 0: pair[0], 1: pair[1] };
    };
    await (room as unknown as { fetch(r: Request): Promise<Response> })
      .fetch(new Request('https://x/ws', { headers: { Upgrade: 'websocket', 'X-Call-Id': 'c1', 'X-User-Id': STUDENT, 'X-Instance': 'reload' } }))
      .catch(() => null);
    expect(pair[1].of('welcome')[0].timer).toMatchObject({ running: false, elapsed_ms: 61_000, duration_ms: 300_000 });
    // Clear: gone for everyone, and logged in the diagnostics.
    await say(t, { type: 'timer', action: { kind: 'clear' } });
    expect(t.of('timer').at(-1)!.timer).toBeNull();
    expect(ctx.store.get('timer')).toBeNull();
    await room.persistNow();
    const diag = JSON.stringify(ctx.store.get('diag') ?? []);
    expect(diag).toMatch(/set a 5 min countdown/);
    expect(diag).toMatch(/took the timer away/);
  });

  it('in a solo call the caller runs it', async () => {
    exec("INSERT INTO calls (id, relationship_id, created_by, status) VALUES ('solo', NULL, ?, 'live')", STUDENT);
    const { join, say } = await openRoom('solo');
    const me = join(STUDENT, 'cs');
    await say(me, { type: 'timer', action: { kind: 'set', mode: 'stopwatch', start: true } });
    expect(me.of('timer').at(-1)!.timer).toMatchObject({ mode: 'stopwatch', running: true });
  });
});

