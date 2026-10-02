/**
 * Presenting a lesson material in a call (round 4): only someone who can see
 * it may present it; presenting it in a relationship's call shares it with the
 * other person; page turns are shared; drawings / text are scoped to a page and
 * saved per lesson in D1; a call later in the same lesson gets them back.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CallRoom } from '../call-room';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import { type ServerMessage } from '@shared/calls';

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
    const ws = new FakeWs({ clientId, userId, name: userId, picture: null, state: { mic: true, cam: true, screen: false, recording: false }, instance: clientId });
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
  exec("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'tutor', 'active')", TUTOR, STUDENT);
  exec("INSERT INTO call_lessons (id, relationship_id, created_by, started_at) VALUES ('les-1', 'rel-1', ?, 1)", TUTOR);
  exec("INSERT INTO materials (id, owner_id, title, kind, status, page_count, created_at, updated_at) VALUES ('m1', ?, '第五课', 'pdf', 'ready', 3, 1, 1)", TUTOR);
  exec("INSERT INTO materials (id, owner_id, title, kind, status, page_count, created_at, updated_at) VALUES ('m2', ?, 'Not yours', 'pdf', 'ready', 1, 1, 1)", STUDENT);
});

afterEach(() => vi.useRealTimers());

describe('CallRoom: presenting a lesson material', () => {
  it('presents, shares, turns pages, scopes drawings to a page and saves them for the lesson', async () => {
    exec("INSERT INTO calls (id, relationship_id, created_by, status, lesson_id) VALUES ('c1', 'rel-1', ?, 'live', 'les-1')", TUTOR);
    const { room, join, say } = await openRoom('c1');
    const t = join(TUTOR, 'ct');
    const s = join(STUDENT, 'cs');
    // Someone else's material that isn't shared: refused.
    await say(t, { type: 'material_open', material_id: 'm2' });
    expect(t.of('error').at(-1)?.message).toMatch(/isn’t available/);
    expect(s.of('material')).toHaveLength(0);
    // The tutor presents their own: both see page 1; it is now shared with the student.
    await say(t, { type: 'material_open', material_id: 'm1' });
    expect(s.of('material').at(-1)?.presenting).toMatchObject({ material_id: 'm1', page: 0, page_count: 3, title: '第五课' });
    expect(db.rows('SELECT relationship_id FROM material_shares WHERE material_id = ?', ['m1'])).toEqual([{ relationship_id: 'rel-1' }]);
    // The student turns the page: shared.
    await say(s, { type: 'material_page', page: 1 });
    expect(t.of('material').at(-1)?.presenting?.page).toBe(1);
    // Drawing on page 2: relayed with its target; on a page not shown: refused.
    const stroke = { id: 's1', color: '#f43f5e', width: 0.006, points: [[0.1, 0.1], [0.3, 0.3]], done: true };
    await say(s, { type: 'annot', stroke, target: 'material:m1:1' });
    expect(t.of('annot').at(-1)).toMatchObject({ target: 'material:m1:1' });
    await say(s, { type: 'annot', stroke: { ...stroke, id: 's2' }, target: 'material:m2:0' });
    expect(t.of('annot')).toHaveLength(1);
    await say(t, { type: 'annot_text', text: { id: 'x', color: '#38bdf8', x: 0.5, y: 0.5, text: '把', size: 0.03, done: true }, target: 'material:m1:1' });
    // Leaving / ending: saved per lesson; the pages shown are remembered for the homework agent.
    await room.snapshot();
    const saved = db.rows<{ page_index: number; data: string }>('SELECT page_index, data FROM material_annotations WHERE lesson_id = ?', ['les-1']);
    expect(saved).toHaveLength(1);
    expect(saved[0].page_index).toBe(1);
    expect(JSON.parse(saved[0].data).texts[0].text.text).toBe('把');
    expect(db.rows('SELECT pages_shown FROM call_materials WHERE call_id = ?', ['c1'])).toEqual([{ pages_shown: '[0,1]' }]);

    // The next call of the lesson: opening page 2 brings its drawings back.
    exec("INSERT INTO calls (id, relationship_id, created_by, status, lesson_id) VALUES ('c2', 'rel-1', ?, 'live', 'les-1')", TUTOR);
    const next = await openRoom('c2');
    const t2 = next.join(TUTOR, 'ct2');
    await next.say(t2, { type: 'material_open', material_id: 'm1', page: 1 });
    const back = t2.of('material_annots').at(-1)!;
    expect(back.target).toBe('material:m1:1');
    expect(back.annots.strokes.map((x) => x.stroke.id)).toEqual(['s1']);
    // Close.
    await next.say(t2, { type: 'material_close' });
    expect(t2.of('material').at(-1)?.presenting).toBeNull();
  });
});
