/**
 * The CallRoom's presence / auto-end state machine with a fake Durable Object
 * (storage, alarm, hibernated sockets) and a mocked clock: who counts as in
 * the call, a silent socket timing out, leave, the empty-room and never-joined
 * deadlines, and that ending goes through the same path as the End button.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const markCallEnded = vi.fn(async () => true);
const saveRoomSnapshot = vi.fn(async () => {});
const advanceCallProcessing = vi.fn(async () => {});
const alertCallMissed = vi.fn(async () => {});
vi.mock('../../services/calls/store', () => ({ markCallEnded: (...a: unknown[]) => markCallEnded(...(a as [])), saveRoomSnapshot: (...a: unknown[]) => saveRoomSnapshot(...(a as [])) }));
vi.mock('../../services/calls/processing', () => ({ advanceCallProcessing: (...a: unknown[]) => advanceCallProcessing(...(a as [])) }));
vi.mock('../../services/calls/alerts', () => ({ alertCallMissed: (...a: unknown[]) => alertCallMissed(...(a as [])) }));

import { CallRoom } from '../call-room';
import { EMPTY_CALL_END_MS, PRESENCE_TIMEOUT_MS, UNJOINED_CALL_END_MS } from '@shared/calls';

const OPEN = 1;
const CLOSED = 3;
// Node 20 (CI) has no global WebSocket; the room only reads WebSocket.OPEN.
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  (globalThis as { WebSocket?: unknown }).WebSocket = { CONNECTING: 0, OPEN, CLOSING: 2, CLOSED };
}

class FakeSocket {
  readyState = OPEN;
  sent: unknown[] = [];
  closed: { code: number; reason: string } | null = null;
  constructor(private attachment: Record<string, unknown>) {}
  deserializeAttachment() {
    return structuredClone(this.attachment);
  }
  serializeAttachment(a: Record<string, unknown>) {
    this.attachment = structuredClone(a);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code: number, reason: string) {
    this.closed = { code, reason };
    this.readyState = CLOSED;
  }
  get att() {
    return this.attachment;
  }
}

function makeRoom() {
  const store = new Map<string, unknown>();
  let alarm: number | null = null;
  const sockets: FakeSocket[] = [];
  const storage = {
    get: async (k: string) => structuredClone(store.get(k)),
    put: async (k: string | Record<string, unknown>, v?: unknown) => {
      if (typeof k === 'string') store.set(k, structuredClone(v));
      else for (const [kk, vv] of Object.entries(k)) store.set(kk, structuredClone(vv));
    },
    setAlarm: async (t: number) => {
      alarm = t;
    },
    deleteAlarm: async () => {
      alarm = null;
    },
  };
  const ctx = { storage, getWebSockets: () => sockets };
  const room = new CallRoom(ctx as never, { DB: {} } as never);
  return {
    room,
    store,
    sockets,
    alarm: () => alarm,
    /** A socket already in the room (as after `fetch` accepted it), last heard `seen`. */
    add(userId: string, seen: number, extra: Record<string, unknown> = {}) {
      const ws = new FakeSocket({ clientId: `c-${userId}-${sockets.length}`, userId, name: userId, picture: null, state: {}, seen, leaveToken: `tok-${userId}`, ...extra });
      sockets.push(ws);
      return ws;
    },
  };
}

const T0 = Date.parse('2026-09-30T08:42:38Z');

describe('CallRoom presence and auto-end', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    for (const f of [markCallEnded, saveRoomSnapshot, advanceCallProcessing, alertCallMissed]) f.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('a call nobody ever enters ends after the never-joined grace, through the End path — no missed-call push hours later', async () => {
    const r = makeRoom();
    // Asked by the list endpoint hours after creation (the stuck production call).
    vi.setSystemTime(T0 + 3 * 3600_000);
    const res = await r.room.presence('call-1', T0);
    expect(res).toEqual({ present: [], ended: true });
    expect(markCallEnded).toHaveBeenCalledWith({}, 'call-1', T0 + 3 * 3600_000);
    expect(advanceCallProcessing).toHaveBeenCalledWith({ DB: {} }, 'call-1');
    expect(alertCallMissed).not.toHaveBeenCalled(); // swept up long after it rang
    expect(r.store.get('ended')).toBe(true);
    // Idempotent: asking again changes nothing.
    markCallEnded.mockClear();
    expect(await r.room.presence('call-1', T0)).toEqual({ present: [], ended: true });
    expect(markCallEnded).not.toHaveBeenCalled();
  });

  it('a fresh unjoined call stays live and arms the alarm for its deadline; the alarm then ends it (with the missed-call push)', async () => {
    const r = makeRoom();
    expect(await r.room.presence('call-1', T0)).toEqual({ present: [], ended: false });
    expect(r.alarm()).toBe(T0 + UNJOINED_CALL_END_MS);
    vi.setSystemTime(T0 + UNJOINED_CALL_END_MS);
    await r.room.alarm();
    expect(markCallEnded).toHaveBeenCalledTimes(1);
    expect(alertCallMissed).toHaveBeenCalledTimes(1);
  });

  it('reports who is present; a socket silent for 45 s is dropped and the other side told', async () => {
    const r = makeRoom();
    await r.room.presence('call-1', T0);
    r.store.set('joined', ['jerome', 'minghui']);
    const jerome = r.add('jerome', T0);
    const minghui = r.add('minghui', T0);
    expect((await r.room.presence('call-1', T0)).present).toEqual(['jerome', 'minghui']);
    // Minghui keeps pinging; Jerome's phone went to sleep without closing its socket.
    vi.setSystemTime(T0 + 30_000);
    await r.room.webSocketMessage(minghui as never, JSON.stringify({ type: 'ping', t: 1 }));
    vi.setSystemTime(T0 + PRESENCE_TIMEOUT_MS + 1_000);
    await r.room.alarm();
    expect(jerome.closed?.code).toBe(4003);
    expect(jerome.att.left).toBe(true);
    expect(minghui.sent).toContainEqual({ type: 'peer_left', client_id: jerome.att.clientId });
    expect((await r.room.presence('call-1', T0)).present).toEqual(['minghui']);
    expect(markCallEnded).not.toHaveBeenCalled();
  });

  it('leave (message or beacon) makes a lone caller absent at once; the call ends 3 min later unless someone comes back', async () => {
    const r = makeRoom();
    await r.room.presence('call-1', T0);
    r.store.set('joined', ['jerome']);
    const jerome = r.add('jerome', T0);
    expect((await r.room.presence('call-1', T0)).present).toEqual(['jerome']);

    vi.setSystemTime(T0 + 60_000);
    await r.room.webSocketMessage(jerome as never, JSON.stringify({ type: 'leave' }));
    expect(jerome.closed?.code).toBe(1000);
    expect((await r.room.presence('call-1', T0)).present).toEqual([]); // no longer "calling"
    expect(r.alarm()).toBe(T0 + 60_000 + EMPTY_CALL_END_MS);

    vi.setSystemTime(T0 + 60_000 + EMPTY_CALL_END_MS - 1);
    await r.room.alarm();
    expect(markCallEnded).not.toHaveBeenCalled();
    vi.setSystemTime(T0 + 60_000 + EMPTY_CALL_END_MS);
    await r.room.alarm();
    expect(markCallEnded).toHaveBeenCalledTimes(1);
  });

  it('the pagehide beacon needs the socket’s own leave token', async () => {
    const r = makeRoom();
    await r.room.presence('call-1', T0);
    r.store.set('joined', ['jerome']);
    const jerome = r.add('jerome', T0);
    expect(await r.room.leave(jerome.att.clientId as string, 'wrong')).toBe(false);
    expect(jerome.closed).toBeNull();
    expect(await r.room.leave(jerome.att.clientId as string, 'tok-jerome')).toBe(true);
    expect(jerome.closed?.code).toBe(1000);
    expect((await r.room.presence('call-1', T0)).present).toEqual([]);
  });

  it('someone coming back within the grace keeps the call; the room empties again later and ends', async () => {
    const r = makeRoom();
    await r.room.presence('call-1', T0);
    r.store.set('joined', ['jerome']);
    const first = r.add('jerome', T0);
    await r.room.webSocketClose(first as never);
    expect(r.alarm()).toBe(T0 + EMPTY_CALL_END_MS);

    vi.setSystemTime(T0 + 60_000);
    r.add('jerome', T0 + 60_000); // rejoined (fetch → reconcile)
    await r.room.alarm();
    expect(markCallEnded).not.toHaveBeenCalled();
    expect(r.store.get('emptySince')).toBeNull();
    // While present, the room wakes when that socket would time out.
    expect(r.alarm()).toBe(T0 + 60_000 + PRESENCE_TIMEOUT_MS + 1_000);
  });

  it('End ends it at once for everyone', async () => {
    const r = makeRoom();
    await r.room.presence('call-1', T0);
    r.store.set('joined', ['jerome', 'minghui']);
    const jerome = r.add('jerome', T0);
    const minghui = r.add('minghui', T0);
    await r.room.webSocketMessage(jerome as never, JSON.stringify({ type: 'end' }));
    expect(markCallEnded).toHaveBeenCalledTimes(1);
    expect(minghui.sent).toContainEqual({ type: 'ended', by: 'jerome' });
    expect(minghui.closed?.code).toBe(1000);
    expect(r.alarm()).toBeNull();
    // The connection log says who ended it, and how.
    const log = r.store.get('diag') as { kind: string; detail: string; user_id: string }[];
    expect(log).toContainEqual(expect.objectContaining({ kind: 'call', user_id: 'jerome', detail: 'jerome ended the call for everyone (End for everyone)' }));
  });

  it('logs a Leave, a timeout and an automatic end in the connection log', async () => {
    const r = makeRoom();
    await r.room.presence('call-1', T0);
    r.store.set('joined', ['jerome', 'minghui']);
    const jerome = r.add('jerome', T0);
    r.add('minghui', T0);
    await r.room.webSocketMessage(jerome as never, JSON.stringify({ type: 'leave' }));
    vi.setSystemTime(T0 + PRESENCE_TIMEOUT_MS + 5_000);
    await r.room.alarm(); // minghui went silent
    vi.setSystemTime(T0 + PRESENCE_TIMEOUT_MS + 5_000 + EMPTY_CALL_END_MS);
    await r.room.alarm();
    const details = (r.store.get('diag') as { kind: string; detail: string }[]).filter((e) => e.kind === 'call').map((e) => e.detail);
    expect(details).toEqual([
      'jerome left (Leave) — the call goes on',
      `minghui timed out (no answer for ${PRESENCE_TIMEOUT_MS / 1000} s)`,
      'Call ended automatically: nobody in it',
    ]);
  });
});
