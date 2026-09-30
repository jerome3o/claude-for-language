/**
 * The call room's board pages, end to end against real SQLite (every migration):
 * a call opens on a new page or continues today's, text goes to the page it was
 * typed on (and only to the people looking at it), pages are made / copied /
 * renamed / deleted, and what a call wrote lands in board_pages,
 * call_board_pages and calls.board_text. The room is driven with fake sockets
 * (no WebSocketPair in Node), so the join handshake itself is not covered here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CallRoom } from '../call-room';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import { TextDoc, type ServerMessage, type TextOp } from '@shared/calls';

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

/** Ops that turn `doc` (the typist's replica) into `text`. */
function typeOps(doc: TextDoc, text: string): TextOp[] {
  return doc.replaceText(text);
}

const pageRows = () =>
  db.rows<{ id: string; position: number; title: string | null; text: string; created_in_call_id: string | null; deleted_at: number | null }>(
    'SELECT id, position, title, text, created_in_call_id, deleted_at FROM board_pages ORDER BY position',
  );

beforeEach(async () => {
  db = await createSqliteD1();
  exec("INSERT INTO users (id, email, name, time_zone) VALUES (?, 't@example.com', 'Tutor', 'UTC')", TUTOR);
  exec("INSERT INTO users (id, email, name) VALUES (?, 's@example.com', 'Student')", STUDENT);
  exec("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'tutor', 'active')", TUTOR, STUDENT);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-30T09:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('call room — board pages', () => {
  it('a first call opens a new page, text reaches only the people on that page, and the call keeps what it wrote', async () => {
    newCall('call-1', 'rel-1');
    const { room, join, say } = await openRoom('call-1');
    const pages = pageRows();
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ position: 1, created_in_call_id: 'call-1', text: '' });
    const page1 = pages[0].id;
    expect(db.rows('SELECT call_id, page_id FROM call_board_pages')).toEqual([{ call_id: 'call-1', page_id: page1 }]);

    const tutor = join(TUTOR, 'c-tutor');
    const student = join(STUDENT, 'c-student');
    const tdoc = new TextDoc(`${TUTOR}:abc`);
    await say(tutor, { type: 'text', page: page1, ops: typeOps(tdoc, '你好 nǐ hǎo') });
    expect(student.of('text')).toHaveLength(1);
    expect(student.of('text')[0].page).toBe(page1);

    // The student opens a new page and types there; the tutor (still on page 1) gets no keystrokes.
    await say(student, { type: 'page_new' });
    const page2 = student.of('page_doc')[0].page;
    expect(page2).not.toBe(page1);
    expect(tutor.of('pages').at(-1)!.pages.map((p) => p.id)).toEqual([page1, page2]);
    expect(tutor.of('page_view').at(-1)).toMatchObject({ client_id: 'c-student', page: page2 });
    const sdoc = new TextDoc(`${STUDENT}:xyz`);
    await say(student, { type: 'text', page: page2, ops: typeOps(sdoc, '谢谢') });
    expect(tutor.of('text')).toHaveLength(0);

    // Thumbnails follow the typing.
    await room.persistNow();
    expect(tutor.of('page_preview').map((p) => [p.page, p.preview])).toEqual(expect.arrayContaining([[page1, '你好 nǐ hǎo'], [page2, '谢谢']]));

    await room.snapshot();
    expect(pageRows().map((p) => p.text)).toEqual(['你好 nǐ hǎo', '谢谢']);
    expect(db.rows('SELECT page_id, text, edited FROM call_board_pages ORDER BY opened_at, page_id')).toEqual(
      expect.arrayContaining([
        { page_id: page1, text: '你好 nǐ hǎo', edited: 1 },
        { page_id: page2, text: '谢谢', edited: 1 },
      ]),
    );
    expect(db.rows('SELECT board_text FROM calls WHERE id = ?', ['call-1'])[0]).toEqual({ board_text: '— Page 1 —\n你好 nǐ hǎo\n\n— Page 2 —\n谢谢' });
  });

  it('a call later the same day continues the page; the next lesson gets a fresh page at the end', async () => {
    newCall('call-1', 'rel-1');
    const first = await openRoom('call-1');
    const tutor = first.join(TUTOR, 'c1');
    const page1 = pageRows()[0].id;
    await first.say(tutor, { type: 'text', page: page1, ops: typeOps(new TextDoc(`${TUTOR}:a`), '第一课') });
    await first.room.snapshot();

    // The call dropped; a new one an hour later picks up the same page.
    vi.setSystemTime(new Date('2026-09-30T10:00:00Z'));
    newCall('call-2', 'rel-1', STUDENT);
    await openRoom('call-2');
    expect(pageRows()).toHaveLength(1);
    expect(db.rows('SELECT call_id FROM call_board_pages WHERE page_id = ? ORDER BY call_id', [page1])).toEqual([{ call_id: 'call-1' }, { call_id: 'call-2' }]);

    // Next week's lesson: a new page 2; page 1 stays in the strip.
    vi.setSystemTime(new Date('2026-10-07T09:00:00Z'));
    newCall('call-3', 'rel-1');
    const third = await openRoom('call-3');
    const rows = pageRows();
    expect(rows.map((p) => [p.position, p.created_in_call_id])).toEqual([[1, 'call-1'], [2, 'call-3']]);
    const t3 = third.join(TUTOR, 'c3');
    await third.say(t3, { type: 'page_open', page: page1 });
    expect(t3.of('page_doc')[0]).toMatchObject({ page: page1 });
    expect(new TextDoc('x', t3.of('page_doc')[0].text).text()).toBe('第一课');
  });

  it('an empty last page is reused rather than piling up blank pages', async () => {
    newCall('call-1', 'rel-1');
    await openRoom('call-1');
    vi.setSystemTime(new Date('2026-10-02T09:00:00Z'));
    newCall('call-2', 'rel-1');
    await openRoom('call-2');
    expect(pageRows()).toHaveLength(1);
  });

  it('duplicate, rename and delete (never the last page); people on a deleted page move to its neighbour', async () => {
    newCall('call-1', 'rel-1');
    const { join, say } = await openRoom('call-1');
    const tutor = join(TUTOR, 'ct');
    const student = join(STUDENT, 'cs');
    const page1 = pageRows()[0].id;
    await say(tutor, { type: 'text', page: page1, ops: typeOps(new TextDoc(`${TUTOR}:a`), '了 le') });
    await say(tutor, { type: 'page_rename', page: page1, title: '  Grammar:\n了  ' });
    expect(pageRows()[0].title).toBe('Grammar: 了');

    await say(tutor, { type: 'page_new' });
    await say(tutor, { type: 'page_duplicate', page: page1 });
    const rows = pageRows();
    expect(rows.map((p) => p.title)).toEqual(['Grammar: 了', 'Grammar: 了 (copy)', null]);
    expect(rows[1].text).toBe('了 le');
    expect(tutor.of('page_doc').at(-1)!.page).toBe(rows[1].id);

    // The student looks at the copy; the tutor deletes it → the student lands on the next page.
    await say(student, { type: 'page_open', page: rows[1].id });
    await say(tutor, { type: 'page_delete', page: rows[1].id });
    expect(student.of('page_deleted')[0]).toMatchObject({ page: rows[1].id, fallback: rows[2].id, by: TUTOR });
    expect(pageRows().filter((p) => !p.deleted_at).map((p) => p.id)).toEqual([page1, rows[2].id]);

    await say(tutor, { type: 'page_delete', page: rows[2].id });
    await say(tutor, { type: 'page_delete', page: page1 });
    expect(tutor.of('error').at(-1)!.message).toMatch(/last page/);
    expect(pageRows().filter((p) => !p.deleted_at)).toHaveLength(1);
  });

  it('"Bring <name> here" reaches the other person; an older client types on the page it was welcomed on', async () => {
    newCall('call-1', 'rel-1');
    const { join, say } = await openRoom('call-1');
    const tutor = join(TUTOR, 'ct');
    const student = join(STUDENT, 'cs');
    const page1 = pageRows()[0].id;
    await say(tutor, { type: 'page_new' });
    const page2 = tutor.of('page_doc')[0].page;
    await say(tutor, { type: 'page_summon', page: page2 });
    expect(student.of('page_summon')[0]).toMatchObject({ from: 'ct', page: page2, name: TUTOR });

    // No `page` on the message: an app from before pages — its view is the opening page.
    await say(student, { type: 'text', ops: typeOps(new TextDoc(`${STUDENT}:old`), 'hi') });
    expect(tutor.of('text')).toHaveLength(0); // the tutor is on page 2
    await say(tutor, { type: 'page_open', page: page1 });
    expect(new TextDoc('x', tutor.of('page_doc').at(-1)!.text).text()).toBe('hi');
  });

  it('a call that ends before anyone joined makes no page', async () => {
    newCall('call-1', 'rel-1');
    const ctx = fakeCtx();
    ctx.store.set('callId', 'call-1');
    const room = new CallRoom(ctx as never, { DB: db } as never) as unknown as Room;
    await room.snapshot();
    expect(pageRows()).toHaveLength(0);
  });

  it('a page of another relationship can neither be opened nor written', async () => {
    exec("INSERT INTO users (id, email) VALUES ('other', 'o@example.com')");
    exec("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-2', 'other', ?, 'tutor', 'active')", STUDENT);
    newCall('call-x', 'rel-2', 'other');
    await openRoom('call-x');
    const foreign = pageRows()[0].id;
    newCall('call-1', 'rel-1');
    const { join, say } = await openRoom('call-1');
    const tutor = join(TUTOR, 'ct');
    await say(tutor, { type: 'page_open', page: foreign });
    expect(tutor.of('page_doc')).toHaveLength(0);
    await say(tutor, { type: 'text', page: foreign, ops: typeOps(new TextDoc(`${TUTOR}:a`), 'x') });
    await say(tutor, { type: 'page_rename', page: foreign, title: 'mine now' });
    expect(db.rows<{ title: string | null }>('SELECT title FROM board_pages WHERE id = ?', [foreign])[0].title).toBeNull();
  });
});
