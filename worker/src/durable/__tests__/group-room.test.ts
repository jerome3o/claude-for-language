/**
 * The GroupRoom (EXPERIMENTAL group classes) with a fake Durable Object: join
 * and welcome, the mesh's signal relay, the tutor's controls (mute forces the
 * student's mic off, students can't use them), raised hands going down on
 * leave, the quiz's per-person views, the board relay, and ending.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const markSessionEnded = vi.fn(async () => {});
vi.mock('../../services/group-classes', () => ({ markSessionEnded: (...a: unknown[]) => markSessionEnded(...(a as [])) }));

import { GroupRoom } from '../group-room';
import type { GroupServerMessage } from '@shared/group';
import { TextDoc } from '@shared/calls';

if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  (globalThis as { WebSocket?: unknown }).WebSocket = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 };
}

const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

class FakeWs {
  readyState = 1;
  sent: GroupServerMessage[] = [];
  closed: number | null = null;
  private att: unknown = null;
  serializeAttachment(a: unknown) {
    this.att = clone(a);
  }
  deserializeAttachment() {
    return clone(this.att);
  }
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  close(code = 1000) {
    this.closed = code;
    this.readyState = 3;
  }
  of<T extends GroupServerMessage['type']>(type: T): Extract<GroupServerMessage, { type: T }>[] {
    return this.sent.filter((m) => m.type === type) as Extract<GroupServerMessage, { type: T }>[];
  }
  last<T extends GroupServerMessage['type']>(type: T) {
    const all = this.of(type);
    return all[all.length - 1];
  }
}

function makeRoom() {
  const store = new Map<string, unknown>();
  const sockets: FakeWs[] = [];
  const ctx = {
    getWebSockets: () => sockets.filter((s) => s.readyState === 1),
    acceptWebSocket: (ws: FakeWs) => sockets.push(ws),
    storage: {
      get: async (k: string) => clone(store.get(k)),
      put: async (k: string | Record<string, unknown>, v?: unknown) => {
        if (typeof k === 'string') store.set(k, clone(v));
        else for (const [kk, vv] of Object.entries(k)) store.set(kk, clone(vv));
      },
      delete: async (k: string) => store.delete(k),
      deleteAll: async () => store.clear(),
      setAlarm: async () => {},
      deleteAlarm: async () => {},
    },
  };
  const room = new GroupRoom(ctx as never, { DB: {} } as never);
  return { room, store, sockets };
}

// The worker runtime's WebSocketPair / a 101 Response, for `fetch` in Node.
class FakeResponse {
  status: number;
  webSocket: unknown;
  constructor(_body: unknown, init?: { status?: number; webSocket?: unknown }) {
    this.status = init?.status ?? 200;
    this.webSocket = init?.webSocket;
  }
}
const realResponse = globalThis.Response;

const TUTOR = 'tutor-1';

async function join(r: ReturnType<typeof makeRoom>, userId: string, name = userId): Promise<{ status: number; ws: FakeWs }> {
  const headers = new Headers({ Upgrade: 'websocket', 'X-Session-Id': 'gs-1', 'X-User-Id': userId, 'X-Tutor-Id': TUTOR, 'X-User-Name': encodeURIComponent(name), 'X-Created-At': String(Date.now()) });
  const before = r.sockets.length;
  const res = (await r.room.fetch({ headers } as unknown as Request)) as unknown as FakeResponse;
  return { status: res.status, ws: r.sockets[before] ?? (null as unknown as FakeWs) };
}

const say = (r: ReturnType<typeof makeRoom>, ws: FakeWs, msg: unknown) => r.room.webSocketMessage(ws as never, JSON.stringify(msg));

describe('GroupRoom', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-13T10:00:00Z'));
    markSessionEnded.mockClear();
    (globalThis as { WebSocketPair?: unknown }).WebSocketPair = class {
      0 = new FakeWs();
      1 = new FakeWs();
    };
    (globalThis as { Response: unknown }).Response = FakeResponse;
  });
  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { Response: unknown }).Response = realResponse;
  });

  it('welcomes each person with the others, the role and the board; others hear peer_joined', async () => {
    const r = makeRoom();
    const t = await join(r, TUTOR, '王老师');
    const a = await join(r, 'stu-a', 'Anna');
    const b = await join(r, 'stu-b', 'Ben');
    expect([t.status, a.status, b.status]).toEqual([101, 101, 101]);
    const welcome = b.ws.last('welcome');
    expect(welcome.tutor_id).toBe(TUTOR);
    expect(welcome.me).toMatchObject({ user_id: 'stu-b', role: 'student', name: 'Ben' });
    expect(welcome.peers.map((p) => p.user_id).sort()).toEqual(['stu-a', TUTOR]);
    expect(t.ws.of('peer_joined').map((m) => m.peer.user_id)).toEqual(['stu-a', 'stu-b']);
    expect(t.ws.last('welcome').me.role).toBe('tutor');
  });

  it('takes the tutor and six students, no more; a second tab replaces the first', async () => {
    const r = makeRoom();
    await join(r, TUTOR);
    for (let i = 0; i < 6; i++) expect((await join(r, `s${i}`)).status).toBe(101);
    expect((await join(r, 's6')).status).toBe(409);
    const again = await join(r, 's0');
    expect(again.status).toBe(101);
    expect(r.sockets[1].closed).toBe(4000);
    expect(r.sockets[1].of('replaced')).toHaveLength(1);
  });

  it('relays WebRTC signals only to the addressed client', async () => {
    const r = makeRoom();
    const t = await join(r, TUTOR);
    const a = await join(r, 'stu-a');
    const b = await join(r, 'stu-b');
    const aId = a.ws.last('welcome').client_id;
    await say(r, t.ws, { type: 'signal', to: aId, data: { description: { type: 'offer', sdp: 'x' } } });
    expect(a.ws.of('signal')).toEqual([{ type: 'signal', from: t.ws.last('welcome').client_id, data: { description: { type: 'offer', sdp: 'x' } } }]);
    expect(b.ws.of('signal')).toEqual([]);
  });

  it('only the tutor mutes; a muted student’s mic is forced off and stays off', async () => {
    const r = makeRoom();
    const t = await join(r, TUTOR);
    const a = await join(r, 'stu-a');
    await say(r, a.ws, { type: 'control', control: { kind: 'mute', user_id: 'stu-b', muted: true } });
    expect(t.ws.of('room')).toHaveLength(0);
    await say(r, t.ws, { type: 'control', control: { kind: 'mute', user_id: 'stu-a', muted: true } });
    expect(a.ws.last('room').room.muted).toEqual(['stu-a']);
    const aClient = a.ws.last('welcome').client_id;
    expect(t.ws.last('peer_state')).toEqual({ type: 'peer_state', client_id: aClient, state: { mic: false, cam: true, screen: false } });
    // The student turns the mic back on: the room says no.
    await say(r, a.ws, { type: 'state', state: { mic: true, cam: true, screen: false } });
    expect(t.ws.last('peer_state').state.mic).toBe(false);
    // The tutor lifts it; now the student may.
    await say(r, t.ws, { type: 'control', control: { kind: 'mute', user_id: 'stu-a', muted: false } });
    await say(r, a.ws, { type: 'state', state: { mic: true, cam: true, screen: false } });
    expect(t.ws.last('peer_state').state.mic).toBe(true);
  });

  it('spotlight and mute all are the tutor’s; a hand goes down when its student leaves', async () => {
    const r = makeRoom();
    const t = await join(r, TUTOR);
    const a = await join(r, 'stu-a');
    const b = await join(r, 'stu-b');
    await say(r, t.ws, { type: 'control', control: { kind: 'spotlight', user_id: 'stu-b' } });
    expect(a.ws.last('room').room.spotlight).toBe('stu-b');
    await say(r, t.ws, { type: 'control', control: { kind: 'mute_all' } });
    expect(a.ws.last('room').room.muted).toEqual(['stu-a', 'stu-b']);
    await say(r, a.ws, { type: 'control', control: { kind: 'hand', up: true } });
    expect(t.ws.last('room').room.hands.map((h) => h.user_id)).toEqual(['stu-a']);
    await say(r, b.ws, { type: 'leave' });
    expect(t.ws.last('room').room.spotlight).toBeNull();
    await say(r, a.ws, { type: 'leave' });
    expect(t.ws.last('room').room.hands).toEqual([]);
    expect(t.ws.of('peer_left')).toHaveLength(2);
  });

  it('the quiz: students see a count, the tutor sees who chose what, everyone sees it after the reveal', async () => {
    const r = makeRoom();
    const t = await join(r, TUTOR);
    const a = await join(r, 'stu-a', 'Anna');
    const b = await join(r, 'stu-b', 'Ben');
    await say(r, a.ws, { type: 'quiz_start', quiz: { question: 'Q', options: ['x', 'y'] } }); // not the tutor
    expect(a.ws.of('quiz')).toHaveLength(0);
    await say(r, t.ws, { type: 'quiz_start', quiz: { question: '“bank” 是？', options: ['银行', '很行', '银杏'], correct: 0 } });
    const id = t.ws.last('quiz').quiz!.id;
    await say(r, a.ws, { type: 'quiz_answer', quiz_id: id, choice: 0 });
    await say(r, b.ws, { type: 'quiz_answer', quiz_id: id, choice: 2 });
    await say(r, t.ws, { type: 'quiz_answer', quiz_id: id, choice: 1 }); // the tutor doesn't answer
    expect(b.ws.last('quiz').quiz).toMatchObject({ answered: 2, mine: 2, answers: null, correct: null });
    expect(t.ws.last('quiz').quiz!.answers).toEqual([
      { user_id: 'stu-a', name: 'Anna', choice: 0 },
      { user_id: 'stu-b', name: 'Ben', choice: 2 },
    ]);
    await say(r, t.ws, { type: 'quiz_reveal', quiz_id: id });
    expect(b.ws.last('quiz').quiz).toMatchObject({ revealed: true, correct: 0, counts: [1, 0, 1] });
    await say(r, t.ws, { type: 'quiz_close' });
    expect(a.ws.last('quiz').quiz).toBeNull();
  });

  it('relays board edits, refuses ones typed under someone else’s site, and hands the board to a newcomer', async () => {
    const r = makeRoom();
    const t = await join(r, TUTOR);
    const a = await join(r, 'stu-a');
    const doc = new TextDoc(`${TUTOR}:p1`);
    const op = doc.localInsert(0, '你好')!;
    await say(r, t.ws, { type: 'text', ops: [op] });
    expect(a.ws.last('text').ops).toEqual([op]);
    // An insert under someone else's site is refused (nobody types as someone else).
    const forged = new TextDoc(`${TUTOR}:p1`).localInsert(0, 'x')!;
    await say(r, a.ws, { type: 'text', ops: [forged] });
    expect(t.ws.of('text')).toHaveLength(0);
    const b = await join(r, 'stu-b');
    const welcome = b.ws.last('welcome');
    expect(new TextDoc('x', welcome.text).text()).toContain('你好');
  });

  it('the tutor ends the class for everyone: D1 is told, the room forgets everything', async () => {
    const r = makeRoom();
    const t = await join(r, TUTOR, '王老师');
    const a = await join(r, 'stu-a');
    await say(r, a.ws, { type: 'chat', text: '老师好' });
    expect(t.ws.last('chat').message.text).toBe('老师好');
    await say(r, a.ws, { type: 'end' }); // a student can't
    expect(a.ws.of('ended')).toHaveLength(0);
    await say(r, t.ws, { type: 'end' });
    expect(a.ws.last('ended')).toEqual({ type: 'ended', by: '王老师' });
    expect(markSessionEnded).toHaveBeenCalledWith({}, 'gs-1', expect.any(Number), 2);
    expect([...r.store.keys()].sort()).toEqual(['ended', 'sessionId']);
    expect((await join(r, 'stu-a')).status).toBe(410);
  });
});
