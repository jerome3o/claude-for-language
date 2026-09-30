/**
 * Board pages outside a call: only the two people of an active relationship
 * read its pages; a call's pages are its members' only; /me/board-pages is
 * everything the user may see. Plus migration 0086: earlier calls' board text
 * becomes the relationship's first pages. Real SQLite with every migration.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../../types';
import boardPages from '../board-pages';
import { applyMigrationsFrom, createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import { insertPage, linkCallPages, loadPageDoc, savePages } from '../../services/calls/pages';
import { TextDoc, sanitizeTextSnapshot, snapshotFromText } from '@shared/calls';

const TUTOR = 'tutor-1';
const STUDENT = 'student-1';
const STRANGER = 'stranger';

let db: SqliteD1;
const exec = (sql: string, ...params: Array<string | number | null>) => db.raw.run(sql, params);

function app(userId: string) {
  const a = new Hono<{ Bindings: Env }>();
  a.use('*', async (c, next) => {
    c.set('user', { id: userId } as never);
    await next();
  });
  a.route('/api', boardPages);
  const env = { DB: db } as unknown as Env;
  return async (path: string) => {
    const res = await a.request(path, {}, env);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
}

function seedPeople() {
  for (const [id, email] of [[TUTOR, 't@x'], [STUDENT, 's@x'], [STRANGER, 'z@x']]) exec('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', id, email, id);
  exec("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'tutor', 'active')", TUTOR, STUDENT);
  exec("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-old', ?, ?, 'tutor', 'removed')", TUTOR, STRANGER);
}

describe('migration 0086 — earlier calls become pages', () => {
  it("each call's board text is a page of its relationship, in call order, linked to the call", async () => {
    db = await createSqliteD1({ stopBefore: '0086' });
    seedPeople();
    const call = (id: string, rel: string | null, by: string, started: number, text: string | null) =>
      exec("INSERT INTO calls (id, relationship_id, created_by, status, started_at, ended_at, board_text) VALUES (?, ?, ?, 'ended', ?, ?, ?)", id, rel, by, started, started + 3_600_000, text);
    call('c-late', 'rel-1', TUTOR, 2_000_000, '第二课\n把字句');
    call('c-early', 'rel-1', STUDENT, 1_000_000, '第一课 😀 你好');
    call('c-empty', 'rel-1', TUTOR, 3_000_000, '   ');
    call('c-null', 'rel-1', TUTOR, 4_000_000, null);
    call('c-solo', null, TUTOR, 500_000, 'solo test');
    applyMigrationsFrom(db, '0086');

    const pages = db.rows<{ id: string; relationship_id: string | null; owner_id: string; position: number; text: string; doc_json: string; created_in_call_id: string; last_used_at: number }>(
      'SELECT * FROM board_pages ORDER BY relationship_id, position',
    );
    expect(pages.map((p) => [p.relationship_id, p.position, p.created_in_call_id, p.owner_id])).toEqual([
      [null, 1, 'c-solo', TUTOR],
      ['rel-1', 1, 'c-early', STUDENT],
      ['rel-1', 2, 'c-late', TUTOR],
    ]);
    // The stored document is exactly snapshotFromText(), and the CRDT loads it with every character (emoji whole).
    const early = pages[1];
    const snap = sanitizeTextSnapshot(JSON.parse(early.doc_json));
    expect(snap).toEqual(snapshotFromText('第一课 😀 你好', 'import:c-early'));
    const doc = new TextDoc(`${TUTOR}:x`, snap);
    expect(doc.text()).toBe('第一课 😀 你好');
    doc.apply(doc.replaceText('第一课 😀 你好！')[0]);
    expect(doc.text()).toBe('第一课 😀 你好！');
    expect(early.last_used_at).toBe(1_000_000 + 3_600_000);
    expect(db.rows('SELECT call_id, text, edited FROM call_board_pages ORDER BY call_id')).toEqual([
      { call_id: 'c-early', text: '第一课 😀 你好', edited: 1 },
      { call_id: 'c-late', text: '第二课\n把字句', edited: 1 },
      { call_id: 'c-solo', text: 'solo test', edited: 1 },
    ]);
  });
});

describe('board page routes', () => {
  beforeEach(async () => {
    db = await createSqliteD1();
    seedPeople();
    exec("INSERT INTO calls (id, relationship_id, created_by, status) VALUES ('call-1', 'rel-1', ?, 'ended')", TUTOR);
    exec("INSERT INTO calls (id, relationship_id, created_by, status) VALUES ('call-solo', NULL, ?, 'ended')", STUDENT);
    const scope = { relationshipId: 'rel-1', userId: TUTOR };
    const p1 = await insertPage(db, scope, { id: 'p1', position: 1, doc: snapshotFromText('第一课', 's'), callId: 'call-1' });
    await insertPage(db, scope, { id: 'p2', position: 2, title: 'Homework', doc: snapshotFromText('作业', 's') });
    await insertPage(db, scope, { id: 'p-gone', position: 3 });
    await savePages(db, scope, [{ id: 'p-gone', deleted_at: Date.now() }]);
    await insertPage(db, { relationshipId: null, userId: STUDENT }, { id: 'p-solo', position: 1, doc: snapshotFromText('mine', 's') });
    await linkCallPages(db, 'call-1', [{ pageId: p1.id, text: '第一课 (then)', edited: true, openedAt: 1 }]);
  });

  it('both people of the relationship read its pages, numbered in strip order; deleted ones are gone', async () => {
    for (const who of [TUTOR, STUDENT]) {
      const { status, body } = await app(who)('/api/relationships/rel-1/board-pages');
      expect(status).toBe(200);
      expect((body.pages as Array<Record<string, unknown>>).map((p) => [p.id, p.number, p.title, p.text, p.chars])).toEqual([
        ['p1', 1, null, '第一课', 3],
        ['p2', 2, 'Homework', '作业', 2],
      ]);
    }
  });

  it('anyone else gets 404 — a stranger, or a relationship that is no longer active', async () => {
    expect((await app(STRANGER)('/api/relationships/rel-1/board-pages')).status).toBe(404);
    expect((await app(TUTOR)('/api/relationships/rel-old/board-pages')).status).toBe(404);
    expect((await app(TUTOR)('/api/relationships/nope/board-pages')).status).toBe(404);
  });

  it('/me/board-pages: my relationships and my own solo pages, nobody else\'s', async () => {
    const mine = (await app(STUDENT)('/api/me/board-pages')).body.pages as Array<{ id: string }>;
    expect(mine.map((p) => p.id).sort()).toEqual(['p-solo', 'p1', 'p2']);
    const tutors = (await app(TUTOR)('/api/me/board-pages')).body.pages as Array<{ id: string }>;
    expect(tutors.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    expect((await app(STRANGER)('/api/me/board-pages')).body.pages).toEqual([]);
  });

  it("a call's pages carry the text written in THAT call; only its members may ask", async () => {
    const { status, body } = await app(STUDENT)('/api/calls/call-1/board-pages');
    expect(status).toBe(200);
    expect(body.pages).toEqual([{ page_id: 'p1', number: 1, title: null, text: '第一课 (then)', edited: true }]);
    expect((await app(STRANGER)('/api/calls/call-1/board-pages')).status).toBe(404);
    expect((await app(TUTOR)('/api/calls/call-solo/board-pages')).status).toBe(404);
  });

  it('a room writes only its own scope', async () => {
    await savePages(db, { relationshipId: null, userId: STUDENT }, [{ id: 'p1', title: 'hijack', doc: snapshotFromText('x', 's') }]);
    expect(db.rows('SELECT title, text FROM board_pages WHERE id = ?', ['p1'])[0]).toEqual({ title: null, text: '第一课' });
    expect(await loadPageDoc(db, { relationshipId: 'rel-1', userId: TUTOR }, 'p-solo')).toBeNull();
    // Links keep "edited" once set.
    await linkCallPages(db, 'call-1', [{ pageId: 'p1', text: 'later', edited: false, openedAt: 5 }]);
    expect(db.rows('SELECT text, edited FROM call_board_pages WHERE page_id = ?', ['p1'])[0]).toEqual({ text: 'later', edited: 1 });
  });
});
