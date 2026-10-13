import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CallRoom } from '../call-room';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import { type ServerMessage } from '@shared/calls';
import { findActivity, type DescribeSpec } from '@shared/call-activities';

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
  const join = (userId: string, clientId: string) => {
    const ws = new FakeWs({ clientId, userId, name: userId, picture: null, state: { mic: true, cam: true, screen: false, recording: false }, instance: clientId, seen: Date.now() });
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

describe('CallRoom: in-call activities', () => {
  it('starts with roles from the relationship, runs the state machine, resyncs stale actions and keeps the result', async () => {
    const { room, ctx, join, say } = await openRoom('c1');
    const t = join(TUTOR, 'ct');
    const s = join(STUDENT, 'cs');
    // An unknown activity is refused.
    await say(s, { type: 'activity_start', activity_id: 'nope' });
    expect(s.of('error').at(-1)?.message).toMatch(/isn’t available/);
    // The STUDENT starts it, but the relationship's tutor (the recipient here) is the host.
    await say(s, { type: 'activity_start', activity_id: 'describe-food-1' });
    const started = t.of('activity').at(-1)!.session!;
    expect(s.of('activity').at(-1)!.session).toEqual(started);
    expect(started.roles).toEqual({ a: STUDENT, b: TUTOR }); // the student describes
    expect(started.host).toBe(TUTOR);
    expect(started.names).toEqual({ [TUTOR]: TUTOR, [STUDENT]: STUDENT });
    expect((ctx.store.get('activity') as { v: number }).v).toBe(1);

    // The describer may not guess: refused → only the sender is told the current state.
    const before = t.sent.length;
    await say(s, { type: 'activity_action', session_id: started.session_id, action: { type: 'pick', option: started.data.options![0] } });
    expect(t.sent.length).toBe(before);
    expect(s.of('activity').at(-1)!.session!.v).toBe(1);
    // A stale session id: the same.
    await say(t, { type: 'activity_action', session_id: 'old', action: { type: 'skip' } });
    expect(t.of('activity').at(-1)!.session!.session_id).toBe(started.session_id);

    // The tutor guesses right: both see the reveal.
    const spec = findActivity('describe-food-1') as DescribeSpec;
    await say(t, { type: 'activity_action', session_id: started.session_id, action: { type: 'pick', option: spec.items[0].hanzi } });
    expect(s.of('activity').at(-1)!.session).toMatchObject({ phase: 'reveal', v: 2, results: [{ round: 0, correct: true }] });
    // Nothing is written until someone leaves / it finishes / it is closed…
    await room.snapshot();
    let rows = db.rows<{ id: string; lesson_id: string; activity_id: string; summary_json: string }>('SELECT id, lesson_id, activity_id, summary_json FROM call_activities');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: started.session_id, lesson_id: 'les-1', activity_id: 'describe-food-1' });
    expect(JSON.parse(rows[0].summary_json)).toMatchObject({ played: 1, correct: 1, finished: false });

    // Close: kept (upserted) and everyone's tile goes away.
    await say(s, { type: 'activity_action', session_id: started.session_id, action: { type: 'finish' } });
    await say(s, { type: 'activity_close', session_id: started.session_id });
    expect(t.of('activity').at(-1)!.session).toBeNull();
    rows = db.rows('SELECT id, lesson_id, activity_id, summary_json FROM call_activities');
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].summary_json)).toMatchObject({ finished: true });
    expect(ctx.store.get('activity')).toBeNull();
  });

  it('starting another keeps the first one’s result; an unplayed one leaves nothing behind', async () => {
    const { join, say } = await openRoom('c1');
    const t = join(TUTOR, 'ct');
    join(STUDENT, 'cs');
    await say(t, { type: 'activity_start', activity_id: 'quiz-tones-1' });
    const q = t.of('activity').at(-1)!.session!;
    await say(t, { type: 'activity_start', activity_id: 'dictation-everyday-1' });
    expect(db.rows('SELECT id FROM call_activities')).toEqual([]);
    const d = t.of('activity').at(-1)!.session!;
    expect(d.session_id).not.toBe(q.session_id);
    expect(d.roles).toEqual({ a: TUTOR, b: STUDENT });
    await say(t, { type: 'activity_action', session_id: d.session_id, action: { type: 'skip' } });
    await say(t, { type: 'activity_start', activity_id: 'quiz-tones-1' });
    // Only a skipped round — nothing played, not finished: nothing kept.
    expect(db.rows('SELECT id FROM call_activities')).toEqual([]);
  });

  it('a solo call holds both roles', async () => {
    exec("INSERT INTO calls (id, relationship_id, created_by, status) VALUES ('solo', NULL, ?, 'live')", TUTOR);
    const { join, say } = await openRoom('solo');
    const t = join(TUTOR, 'ct');
    await say(t, { type: 'activity_start', activity_id: 'dictation-everyday-1' });
    const sess = t.of('activity').at(-1)!.session!;
    expect(sess.roles).toEqual({ a: TUTOR, b: TUTOR });
    for (const action of [{ type: 'ask' }, { type: 'draft', text: '你好' }, { type: 'reveal' }]) {
      await say(t, { type: 'activity_action', session_id: sess.session_id, action });
    }
    expect(t.of('activity').at(-1)!.session!.results[0]).toMatchObject({ correct: true, answer: '你好' });
  });

  it('someone who arrived after the start takes a role with their first action', async () => {
    const { join, say } = await openRoom('c1');
    const t = join(TUTOR, 'ct');
    await say(t, { type: 'activity_start', activity_id: 'describe-food-1' });
    const solo = t.of('activity').at(-1)!.session!;
    expect(solo.roles).toEqual({ a: TUTOR, b: TUTOR });
    const s = join(STUDENT, 'cs');
    // The student (now the describer) skips the round: accepted, roles split, both told.
    await say(s, { type: 'activity_action', session_id: solo.session_id, action: { type: 'skip' } });
    const after = t.of('activity').at(-1)!.session!;
    expect(after.roles).toEqual({ a: STUDENT, b: TUTOR });
    expect(after.round).toBe(1);
    expect(s.of('activity').at(-1)!.session).toEqual(after);
    // A new start with both in the call splits the roles straight away.
    await say(t, { type: 'activity_start', activity_id: 'quiz-tones-1' });
    const q = t.of('activity').at(-1)!.session!;
    expect(q.roles).toEqual({ a: TUTOR, b: STUDENT });
  });
});

describe('CallRoom: prepared activities (docs/VIDEO_CALLS.md "Prepared activities")', () => {
  const spec = {
    id: 'job-1-1', kind: 'dictation', title: "Dictation: last lesson's words", level: 'elementary', topic: 'Last lesson', summary: 's',
    role_names: { a: 'Reader', b: 'Writer' }, tutor_role: 'a',
    items: [{ hanzi: '头疼', pinyin: 'tóuténg', english: 'headache' }, { hanzi: '发烧', pinyin: 'fāshāo', english: 'fever' }, { hanzi: '感冒', pinyin: 'gǎnmào', english: 'a cold' }],
  };
  const prepare = (id: string, rel: string, json: unknown = spec) =>
    exec(
      "INSERT INTO prepared_activities (id, relationship_id, tutor_id, student_id, job_id, kind, title, why, spec_json, status) VALUES (?, ?, ?, ?, 'job-1', 'dictation', 't', 'why', ?, 'ready')",
      id, rel, TUTOR, STUDENT, JSON.stringify(json),
    );

  it('only the tutor starts one, only from this relationship; it plays like a catalogue activity and is marked used', async () => {
    exec("INSERT INTO users (id, email, name) VALUES ('other', 'o@example.com', 'Other')");
    exec("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-2', 'other', ?, 'student', 'active')", TUTOR);
    prepare('job-1-1', 'rel-1');
    prepare('job-9-1', 'rel-2');
    prepare('job-1-2', 'rel-1', { ...spec, items: [] }); // broken: refused, never started
    const { join, say } = await openRoom('c1');
    const t = join(TUTOR, 'ct');
    const s = join(STUDENT, 'cs');
    // The student can't start the tutor's prepared material.
    await say(s, { type: 'activity_start', activity_id: 'prepared:job-1-1' });
    expect(s.of('error').at(-1)?.message).toMatch(/Only the tutor/);
    expect(t.of('activity')).toHaveLength(0);
    // Another student's / a broken one: not available.
    await say(t, { type: 'activity_start', activity_id: 'prepared:job-9-1' });
    expect(t.of('error').at(-1)?.message).toMatch(/isn’t available/);
    await say(t, { type: 'activity_start', activity_id: 'prepared:job-1-2' });
    expect(t.of('error').at(-1)?.message).toMatch(/isn’t available/);
    expect(db.rows<{ status: string }>("SELECT status FROM prepared_activities WHERE id = 'job-1-2'")[0].status).toBe('ready');

    await say(t, { type: 'activity_start', activity_id: 'prepared:job-1-1' });
    const started = s.of('activity').at(-1)!.session!;
    expect(started.spec.id).toBe('prepared:job-1-1');
    expect(started.roles).toEqual({ a: TUTOR, b: STUDENT }); // the tutor reads, the student writes
    await say(t, { type: 'activity_action', session_id: started.session_id, action: { type: 'ask' } });
    await say(s, { type: 'activity_action', session_id: started.session_id, action: { type: 'draft', text: '头疼' } });
    await say(s, { type: 'activity_action', session_id: started.session_id, action: { type: 'submit' } });
    await say(t, { type: 'activity_action', session_id: started.session_id, action: { type: 'reveal' } });
    expect(t.of('activity').at(-1)!.session).toMatchObject({ phase: 'reveal', results: [{ round: 0, correct: true }] });
    const row = db.rows<{ status: string; used_in_call_id: string }>("SELECT status, used_in_call_id FROM prepared_activities WHERE id = 'job-1-1'")[0];
    expect(row).toEqual({ status: 'used', used_in_call_id: 'c1' });
    await say(t, { type: 'activity_close', session_id: started.session_id });
    expect(db.rows<{ activity_id: string }>('SELECT activity_id FROM call_activities')).toEqual([{ activity_id: 'prepared:job-1-1' }]);
  });
});
