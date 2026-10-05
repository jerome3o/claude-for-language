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
import { EMPTY_CALL_END_MS, PRESENCE_TIMEOUT_MS, ROOM_RETRY_MS, UNJOINED_CALL_END_MS } from '@shared/calls';

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
    delete: async (k: string) => store.delete(k),
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

  it('a failed save when the last person leaves still arms the end alarm, and the call ends 10 min later', async () => {
    const r = makeRoom();
    await r.room.presence('call-1', T0);
    r.store.set('joined', ['jerome', 'minghui']);
    const jerome = r.add('jerome', T0);
    const minghui = r.add('minghui', T0);
    await r.room.webSocketMessage(jerome as never, JSON.stringify({ type: 'leave' }));
    // The snapshot (D1 / storage) throws as the last person goes: the plan must still run.
    const snap = vi.spyOn(r.room as unknown as { snapshot(): Promise<void> }, 'snapshot').mockRejectedValue(new Error('D1 unavailable'));
    vi.setSystemTime(T0 + 30_000);
    await r.room.webSocketMessage(minghui as never, JSON.stringify({ type: 'leave' }));
    expect(r.alarm()).toBe(T0 + 30_000 + EMPTY_CALL_END_MS);
    vi.setSystemTime(T0 + 30_000 + EMPTY_CALL_END_MS);
    await r.room.alarm(); // the end path's snapshot still fails — the call ends anyway
    expect(markCallEnded).toHaveBeenCalledWith({}, 'call-1', T0 + 30_000 + EMPTY_CALL_END_MS);
    expect(r.store.get('ended')).toBe(true);
    snap.mockRestore();
  });

  it('ending retries the D1 write until it lands (alarm, then any presence look) — never "ended" in the room but live in the list', async () => {
    const r = makeRoom();
    await r.room.presence('call-1', T0);
    r.store.set('joined', ['jerome']);
    const jerome = r.add('jerome', T0);
    markCallEnded.mockRejectedValueOnce(new Error('D1 overloaded'));
    await r.room.webSocketMessage(jerome as never, JSON.stringify({ type: 'end' }));
    expect(r.store.get('ended')).toBe(true);
    expect(r.store.get('endPending')).toBe(true);
    expect(r.alarm()).toBe(T0 + ROOM_RETRY_MS); // a retry is armed
    expect(advanceCallProcessing).not.toHaveBeenCalled();
    vi.setSystemTime(T0 + ROOM_RETRY_MS);
    await r.room.alarm();
    expect(markCallEnded).toHaveBeenCalledTimes(2);
    expect(markCallEnded).toHaveBeenLastCalledWith({}, 'call-1', T0); // the time it really ended
    expect(r.store.get('endPending')).toBe(false);
    expect(advanceCallProcessing).toHaveBeenCalledTimes(1);
    // Done: later looks don't write again.
    expect(await r.room.presence('call-1', T0)).toEqual({ present: [], ended: true });
    expect(markCallEnded).toHaveBeenCalledTimes(2);
  });

  it('an alarm that throws arms its own retry instead of going quiet for good', async () => {
    const r = makeRoom();
    await r.room.presence('call-1', T0); // nobody ever came: due to end at T0 + 10 min
    const spy = vi.spyOn(r.room as unknown as { reconcile(): Promise<unknown> }, 'reconcile').mockRejectedValueOnce(new Error('storage hiccup'));
    vi.setSystemTime(T0 + 5 * 60_000);
    await r.room.alarm();
    expect(r.alarm()).toBe(T0 + 5 * 60_000 + ROOM_RETRY_MS);
    spy.mockRestore();
    vi.setSystemTime(T0 + 3 * 3600_000);
    await r.room.alarm();
    expect(markCallEnded).toHaveBeenCalledTimes(1);
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

describe('CallRoom: text on a shared screen and kept drawings (round 4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  it('relays text boxes, keeps them (Keep is the default) with finished strokes, forgets them on Clear or fade', async () => {
    const r = makeRoom();
    await r.room.presence('call-1', T0);
    const jerome = r.add('jerome', T0);
    const minghui = r.add('minghui', T0);
    const text = { id: 't1', color: '#f43f5e', x: 0.2, y: 0.3, text: '把字句', size: 0.032, done: true };
    await r.room.webSocketMessage(minghui as never, JSON.stringify({ type: 'annot_text', text }));
    expect(jerome.sent).toContainEqual({ type: 'annot_text', from: 'c-minghui-1', name: 'minghui', text });
    await r.room.webSocketMessage(jerome as never, JSON.stringify({ type: 'annot', stroke: { id: 's1', color: '#38bdf8', width: 0.006, points: [[0.1, 0.1], [0.2, 0.2]], done: false } }));
    await r.room.webSocketMessage(jerome as never, JSON.stringify({ type: 'annot', stroke: { id: 's1', color: '#38bdf8', width: 0.006, points: [[0.1, 0.1], [0.2, 0.2]], done: true } }));
    const kept = r.store.get('annots') as { strokes: { key: string }[]; texts: { text: { id: string; text: string } }[] };
    expect(kept.texts.map((t) => t.text.text)).toEqual(['把字句']);
    expect(kept.strokes.map((s) => s.key)).toEqual(['c-jerome-0:s1']);
    // Moved: the same id, one entry.
    await r.room.webSocketMessage(jerome as never, JSON.stringify({ type: 'annot_text', text: { ...text, x: 0.5 } }));
    expect((r.store.get('annots') as typeof kept).texts).toHaveLength(1);
    // Deleted.
    await r.room.webSocketMessage(jerome as never, JSON.stringify({ type: 'annot_text_delete', id: 't1' }));
    expect(minghui.sent).toContainEqual({ type: 'annot_text_delete', from: 'c-jerome-0', id: 't1' });
    expect((r.store.get('annots') as typeof kept).texts).toHaveLength(0);
    // Clear forgets everything; so does switching to fading.
    await r.room.webSocketMessage(jerome as never, JSON.stringify({ type: 'annot_clear' }));
    expect(r.store.get('annots')).toBeUndefined();
    await r.room.webSocketMessage(jerome as never, JSON.stringify({ type: 'annot_text', text }));
    await r.room.webSocketMessage(jerome as never, JSON.stringify({ type: 'annot_mode', persist: false }));
    expect(r.store.get('annots')).toBeUndefined();
    // While fading, nothing is kept.
    await r.room.webSocketMessage(jerome as never, JSON.stringify({ type: 'annot_text', text }));
    expect(r.store.get('annots')).toBeUndefined();
  });
});
