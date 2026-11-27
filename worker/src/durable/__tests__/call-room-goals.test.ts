import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CallRoom } from '../call-room';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import { type CallGoals, type ServerMessage } from '@shared/calls';
import { lessonGoals, usedGoalNames, initCallGoals } from '../../services/calls/goals';

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

interface Room {
  loadPages(): Promise<void>;
  snapshot(): Promise<void>;
  webSocketMessage(ws: unknown, raw: string): Promise<void>;
  fetch(r: Request): Promise<Response>;
}

async function openRoom(callId: string) {
  const ctx = fakeCtx();
  ctx.store.set('callId', callId);
  const room = new CallRoom(ctx as never, { DB: db } as never) as unknown as Room;
  await room.loadPages();
  const join = (userId: string, clientId: string) => {
    const ws = new FakeWs({ clientId, userId, name: userId === TUTOR ? 'Minghui Li' : 'Jerome', picture: null, state: { mic: true, cam: true, screen: false, recording: false }, instance: clientId, seen: Date.now() });
    ctx.sockets.push(ws);
    return ws;
  };
  const say = (ws: FakeWs, msg: unknown) => room.webSocketMessage(ws as never, JSON.stringify(msg));
  /** A real join through fetch: the welcome message. */
  const welcome = async (userId: string) => {
    const pair = [new FakeWs(null), new FakeWs(null)];
    (globalThis as { WebSocketPair?: unknown }).WebSocketPair = function WebSocketPair() {
      return { 0: pair[0], 1: pair[1] };
    };
    await room.fetch(new Request('https://x/ws', { headers: { Upgrade: 'websocket', 'X-Call-Id': callId, 'X-User-Id': userId, 'X-Instance': `i-${userId}` } })).catch(() => null);
    return pair[1].of('welcome')[0];
  };
  return { room, ctx, join, say, welcome };
}

const besides = {
  title: '除了',
  sections: [{ exercises: [{ type: 'note', patterns: [{ name: '除了…还…', pieces: [{ hanzi: '除了' }, { slot: 'Noun' }, { hanzi: '，' }, { slot: 'Subject' }, { hanzi: '还' }, { slot: 'Verb' }], meaning: 'besides A, also B', examples: [{ hanzi: '除了中文，我还学日语。' }] }] }] }],
};
const once = {
  title: '一就',
  sections: [{ exercises: [{ type: 'note', patterns: [{ name: '一…就…', pieces: [{ hanzi: '一' }, { slot: 'Verb' }, { hanzi: '就' }, { slot: 'Verb' }], meaning: 'as soon as', examples: [{ hanzi: '我一到家就睡觉。' }] }] }] }],
};

beforeEach(async () => {
  db = await createSqliteD1();
  exec("INSERT INTO users (id, email, name) VALUES (?, 't@example.com', 'Minghui Li')", TUTOR);
  exec("INSERT INTO users (id, email, name) VALUES (?, 's@example.com', 'Jerome Swannack')", STUDENT);
  exec("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'student', 'active')", STUDENT, TUTOR);
  exec("INSERT INTO call_lessons (id, relationship_id, created_by, started_at) VALUES ('les-1', 'rel-1', ?, 1)", TUTOR);
  exec("INSERT INTO calls (id, relationship_id, created_by, status, lesson_id) VALUES ('c1', 'rel-1', ?, 'live', 'les-1')", TUTOR);
  const recent = new Date(Date.now() - 3 * 86_400_000).toISOString();
  exec("INSERT INTO custom_lessons (id, user_id, title, spec, updated_at) VALUES ('l-1', ?, '除了', ?, '2026-10-01 00:00:00')", STUDENT, JSON.stringify(besides));
  exec("INSERT INTO custom_lessons (id, user_id, title, spec, updated_at) VALUES ('l-2', ?, '一就', ?, '2026-10-01 00:00:00')", STUDENT, JSON.stringify(once));
  exec("INSERT INTO custom_lesson_completions (id, user_id, lesson_id, correct, total, completed_at) VALUES ('x1', ?, 'l-1', 3, 4, ?)", STUDENT, recent);
  exec("INSERT INTO custom_lesson_completions (id, user_id, lesson_id, correct, total, completed_at) VALUES ('x2', ?, 'l-2', 3, 4, ?)", STUDENT, recent);
});

afterEach(() => vi.useRealTimers());

describe('CallRoom: 🎯 structures to use', () => {
  it('picks the student’s structures on the first join and sends them in welcome', async () => {
    const { welcome } = await openRoom('c1');
    const w = await welcome(TUTOR);
    expect(w.goals).toMatchObject({ student_id: STUDENT, student_name: 'Jerome Swannack', available: 2 });
    expect(w.goals!.goals.map((g) => g.name).sort()).toEqual(['一…就…', '除了…还…']);
    expect(w.goals!.goals.every((g) => g.status === 'open')).toBe(true);
  });

  it('only the student’s speech ticks; the tutor ticks by hand; everyone adds; saved to D1; the next call prefers others', async () => {
    const { room, join, say, welcome } = await openRoom('c1');
    const first = (await welcome(STUDENT)).goals!;
    const besidesGoal = first.goals.find((g) => g.name === '除了…还…')!;
    const onceGoal = first.goals.find((g) => g.name === '一…就…')!;
    const t = join(TUTOR, 'ct');
    const s = join(STUDENT, 'cs');
    // The tutor's device can't claim his speech.
    await say(t, { type: 'goals', action: { kind: 'heard', id: besidesGoal.id, text: '除了中文我还学日语' } });
    expect(s.of('goals')).toHaveLength(0);
    expect(t.of('error').at(-1)?.message).toMatch(/student’s own speech/);
    // His device heard it: checking for both, then used.
    await say(s, { type: 'goals', action: { kind: 'heard', id: besidesGoal.id, text: '除了中文我还学日语' } });
    expect(t.of('goals').at(-1)!.goals.goals.find((g) => g.id === besidesGoal.id)!.status).toBe('checking');
    await say(s, { type: 'goals', action: { kind: 'checked', id: besidesGoal.id, text: '除了中文我还学日语', ok: true } });
    const after = t.of('goals').at(-1)!.goals;
    expect(after.goals.find((g) => g.id === besidesGoal.id)).toMatchObject({ status: 'used', used: { text: '除了中文我还学日语', by: 'auto' } });
    // He can't tick by hand; she can.
    await say(s, { type: 'goals', action: { kind: 'tick', id: onceGoal.id } });
    expect(s.of('error').at(-1)?.message).toMatch(/Only the tutor/);
    await say(t, { type: 'goals', action: { kind: 'tick', id: onceGoal.id } });
    expect(s.of('goals').at(-1)!.goals.goals.find((g) => g.id === onceGoal.id)).toMatchObject({ status: 'used', used: { by: 'tutor', name: 'Minghui Li' } });
    // Either adds.
    await say(s, { type: 'goals', action: { kind: 'add', text: '本来…要…' } });
    expect(t.of('goals').at(-1)!.goals.goals.map((g) => g.name)).toContain('本来…要…');
    // Saved on leave / end.
    await room.snapshot();
    expect(await usedGoalNames(db as never, STUDENT)).toEqual(expect.arrayContaining(['除了…还…', '一…就…']));
    const merged = await lessonGoals(db as never, ['c1']);
    expect(merged.map((g) => `${g.name}:${g.status}`).sort()).toEqual(['一…就…:used', '本来…要…:open', '除了…还…:used'].sort());
    // A new call in ANOTHER lesson: the used ones are only picked to make up the minimum.
    exec("INSERT INTO call_lessons (id, relationship_id, created_by, started_at) VALUES ('les-2', 'rel-1', ?, 2)", TUTOR);
    exec("INSERT INTO calls (id, relationship_id, created_by, status, lesson_id) VALUES ('c2', 'rel-1', ?, 'live', 'les-2')", TUTOR);
    const next = (await initCallGoals(db as never, { id: 'c2', relationship_id: 'rel-1', lesson_id: 'les-2', created_by: TUTOR }, TUTOR, Date.now()))!;
    expect(next.goals.map((g) => g.name).sort()).toEqual(['一…就…', '除了…还…']);
    // A second call of the SAME lesson carries the list on, ticks included.
    exec("INSERT INTO calls (id, relationship_id, created_by, status, lesson_id, created_at) VALUES ('c3', 'rel-1', ?, 'live', 'les-1', datetime('now', '+1 minute'))", TUTOR);
    const carried = (await initCallGoals(db as never, { id: 'c3', relationship_id: 'rel-1', lesson_id: 'les-1', created_by: TUTOR }, TUTOR, Date.now()))!;
    expect(carried.goals.filter((g) => g.status === 'used')).toHaveLength(2);
    expect(carried.goals.map((g) => g.name)).toContain('本来…要…');
  });

  it('a student with no structures: an empty list, the tutor adds one', async () => {
    exec('DELETE FROM custom_lesson_completions');
    const { join, say, welcome } = await openRoom('c1');
    const w = await welcome(TUTOR);
    expect(w.goals).toMatchObject({ goals: [], available: 0 });
    const t = join(TUTOR, 'ct');
    await say(t, { type: 'goals', action: { kind: 'add', text: '一…就…' } });
    expect((t.of('goals').at(-1)!.goals as CallGoals).goals[0]).toMatchObject({ name: '一…就…', fixed: ['一', '就'], source: 'added' });
  });

  it('two joins at once get the same list', async () => {
    const { room } = await openRoom('c1');
    const r = room as unknown as { goals(): Promise<CallGoals | null> };
    const [a, b] = await Promise.all([r.goals(), r.goals()]);
    expect(a!.goals.map((g) => g.id)).toEqual(b!.goals.map((g) => g.id));
  });

  it('a solo call: the caller is the student', async () => {
    exec("INSERT INTO calls (id, relationship_id, created_by, status) VALUES ('solo', NULL, ?, 'live')", STUDENT);
    const { welcome } = await openRoom('solo');
    expect((await welcome(STUDENT)).goals).toMatchObject({ student_id: STUDENT });
  });

  it('never in the way of joining: a failing D1 → no list', async () => {
    const { welcome, ctx } = await openRoom('c1');
    const broken = { prepare: () => { throw new Error('D1 down'); } };
    (ctx as unknown as { store: Map<string, unknown> }).store.delete('goalsInit');
    const room2 = new CallRoom(ctx as never, { DB: broken } as never) as unknown as { goals(): Promise<unknown> };
    expect(await room2.goals()).toBeNull();
    // The real room still welcomes.
    expect((await welcome(STUDENT)).type).toBe('welcome');
  });
});
