/**
 * Board pages in D1 (migration 0086; rules in shared/calls/pages.ts).
 *
 * A page belongs to a SCOPE: a tutor relationship (both people see and write
 * it) or, for a solo test call, its caller. The CallRoom Durable Object loads
 * the scope's pages when a call starts, holds them while it is live and writes
 * them back here (`savePages`) when someone leaves / the call ends; page
 * structure changes (new / rename / duplicate / delete) are written at once.
 * Outside a call the pages are read-only (GET routes below): editing happens
 * in a call, where the room merges both people's typing — a second writer
 * outside the room could not be merged into its CRDT.
 */

import { generateId } from '../cards';
import { pagePreview, sanitizeTextSnapshot, snapshotText, type BoardPageMeta, type TextDocSnapshot } from '@shared/calls';

export interface PageScope {
  relationshipId: string | null;
  /** The solo caller (relationshipId null) — or, for a relationship, whoever makes a new page. */
  userId: string;
}

export interface BoardPageRow {
  id: string;
  relationship_id: string | null;
  owner_id: string;
  position: number;
  title: string | null;
  doc_json: string | null;
  text: string;
  created_in_call_id: string | null;
  created_at: number;
  updated_at: number;
  last_used_at: number;
  deleted_at: number | null;
}

/** The page as a room keeps it (meta + when it was last used), without its document. */
export interface RoomPage extends BoardPageMeta {
  last_used_at: number;
}

function scopeWhere(scope: PageScope): { sql: string; params: unknown[] } {
  return scope.relationshipId
    ? { sql: 'relationship_id = ?', params: [scope.relationshipId] }
    : { sql: 'relationship_id IS NULL AND owner_id = ?', params: [scope.userId] };
}

export function rowToMeta(r: Pick<BoardPageRow, 'id' | 'title' | 'text' | 'created_at' | 'updated_at' | 'created_in_call_id' | 'last_used_at'>): RoomPage {
  return {
    id: r.id,
    title: r.title,
    preview: pagePreview(r.text ?? ''),
    chars: Array.from(r.text ?? '').length,
    created_at: r.created_at,
    updated_at: r.updated_at,
    call_id: r.created_in_call_id,
    last_used_at: r.last_used_at,
  };
}

/** The scope's live pages in strip order (no documents). */
export async function loadScopePages(db: D1Database, scope: PageScope): Promise<RoomPage[]> {
  const w = scopeWhere(scope);
  const rows = await db
    .prepare(
      `SELECT id, title, text, created_at, updated_at, created_in_call_id, last_used_at FROM board_pages
        WHERE ${w.sql} AND deleted_at IS NULL ORDER BY position, created_at`,
    )
    .bind(...w.params)
    .all<BoardPageRow>();
  return (rows.results ?? []).map(rowToMeta);
}

/** One page's document (null: unknown page, or a page of another scope). */
export async function loadPageDoc(db: D1Database, scope: PageScope, pageId: string): Promise<TextDocSnapshot | null> {
  const w = scopeWhere(scope);
  const row = await db
    .prepare(`SELECT doc_json, text FROM board_pages WHERE id = ? AND ${w.sql}`)
    .bind(pageId, ...w.params)
    .first<{ doc_json: string | null; text: string }>();
  if (!row) return null;
  let snap: TextDocSnapshot | null = null;
  try {
    snap = row.doc_json ? sanitizeTextSnapshot(JSON.parse(row.doc_json)) : null;
  } catch {
    snap = null;
  }
  return snap ?? { v: 1, runs: row.text ? [[1, `import:${pageId}`, row.text, 0]] : [] };
}

export async function insertPage(
  db: D1Database,
  scope: PageScope,
  page: { id?: string; position: number; title?: string | null; doc?: TextDocSnapshot | null; callId?: string | null; now?: number },
): Promise<RoomPage> {
  const id = page.id ?? generateId();
  const now = page.now ?? Date.now();
  const doc = page.doc ?? { v: 1, runs: [] };
  const text = snapshotText(doc);
  await db
    .prepare(
      `INSERT INTO board_pages (id, relationship_id, owner_id, position, title, doc_json, text, created_in_call_id, created_at, updated_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, scope.relationshipId, scope.userId, page.position, page.title ?? null, JSON.stringify(doc), text, page.callId ?? null, now, now, now)
    .run();
  return rowToMeta({ id, title: page.title ?? null, text, created_at: now, updated_at: now, created_in_call_id: page.callId ?? null, last_used_at: now });
}

export interface PageWrite {
  id: string;
  position?: number;
  title?: string | null;
  doc?: TextDocSnapshot;
  updated_at?: number;
  last_used_at?: number;
  deleted_at?: number;
}

/** Write pages back (only the fields given), scoped so a room can only touch its own pages. */
export async function savePages(db: D1Database, scope: PageScope, writes: PageWrite[]): Promise<void> {
  if (writes.length === 0) return;
  const w = scopeWhere(scope);
  const stmts = writes.map((p) => {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (p.position !== undefined) (sets.push('position = ?'), params.push(p.position));
    if (p.title !== undefined) (sets.push('title = ?'), params.push(p.title));
    if (p.doc) (sets.push('doc_json = ?', 'text = ?'), params.push(JSON.stringify(p.doc), snapshotText(p.doc)));
    if (p.updated_at !== undefined) (sets.push('updated_at = ?'), params.push(p.updated_at));
    if (p.last_used_at !== undefined) (sets.push('last_used_at = MAX(last_used_at, ?)'), params.push(p.last_used_at));
    if (p.deleted_at !== undefined) (sets.push('deleted_at = ?'), params.push(p.deleted_at));
    return db.prepare(`UPDATE board_pages SET ${sets.join(', ')} WHERE id = ? AND ${w.sql}`).bind(...params, p.id, ...w.params);
  });
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
}

/** Link a page to a call (opened / written in it), keeping the page's text as it stands. */
export async function linkCallPages(
  db: D1Database,
  callId: string,
  links: { pageId: string; text: string; edited: boolean; openedAt: number }[],
): Promise<void> {
  if (links.length === 0) return;
  const stmts = links.map((l) =>
    db
      .prepare(
        `INSERT INTO call_board_pages (call_id, page_id, text, edited, opened_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(call_id, page_id) DO UPDATE SET text = excluded.text, edited = MAX(edited, excluded.edited)`,
      )
      .bind(callId, l.pageId, l.text, l.edited ? 1 : 0, l.openedAt),
  );
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
}

export interface BoardPageListItem {
  id: string;
  /** 1-based, strip order. */
  number: number;
  title: string | null;
  text: string;
  chars: number;
  created_at: number;
  updated_at: number;
  call_id: string | null;
  relationship_id: string | null;
}

function toListItems(rows: BoardPageRow[]): BoardPageListItem[] {
  const counters = new Map<string, number>();
  return rows.map((r) => {
    const scope = r.relationship_id ?? `user:${r.owner_id}`;
    const n = (counters.get(scope) ?? 0) + 1;
    counters.set(scope, n);
    return {
      id: r.id,
      number: n,
      title: r.title,
      text: r.text ?? '',
      chars: Array.from(r.text ?? '').length,
      created_at: r.created_at,
      updated_at: r.updated_at,
      call_id: r.created_in_call_id,
      relationship_id: r.relationship_id,
    };
  });
}

/** A relationship's pages with their text (read-only view outside a call). */
export async function listRelationshipPages(db: D1Database, relationshipId: string): Promise<BoardPageListItem[]> {
  const rows = await db
    .prepare(
      `SELECT id, relationship_id, owner_id, title, text, created_at, updated_at, created_in_call_id FROM board_pages
        WHERE relationship_id = ? AND deleted_at IS NULL ORDER BY position, created_at`,
    )
    .bind(relationshipId)
    .all<BoardPageRow>();
  return toListItems(rows.results ?? []);
}

/** Every page the user can see: their relationships' pages and their solo calls' pages (the offline cache). */
export async function listMyPages(db: D1Database, userId: string): Promise<BoardPageListItem[]> {
  const rows = await db
    .prepare(
      `SELECT id, relationship_id, owner_id, title, text, created_at, updated_at, created_in_call_id FROM board_pages
        WHERE deleted_at IS NULL AND (
          relationship_id IN (SELECT id FROM tutor_relationships WHERE (requester_id = ? OR recipient_id = ?) AND status = 'active')
          OR (relationship_id IS NULL AND owner_id = ?))
        ORDER BY relationship_id, position, created_at
        LIMIT 2000`,
    )
    .bind(userId, userId, userId)
    .all<BoardPageRow>();
  return toListItems(rows.results ?? []);
}

export interface CallPageItem {
  page_id: string;
  /** The page's number in its strip today (null: the page was deleted since). */
  number: number | null;
  title: string | null;
  /** The page as it stood when the call ended (or now, while it is live). */
  text: string;
  edited: boolean;
}

/** The pages a call opened / wrote on, in strip order, with the text each held at the end of that call. */
export async function listCallPages(db: D1Database, callId: string, relationshipId: string | null, userId: string): Promise<CallPageItem[]> {
  const links = await db
    .prepare(
      `SELECT l.page_id, l.text, l.edited, l.opened_at, p.title, p.position, p.deleted_at
         FROM call_board_pages l LEFT JOIN board_pages p ON p.id = l.page_id
        WHERE l.call_id = ? ORDER BY COALESCE(p.position, 1e9), l.opened_at`,
    )
    .bind(callId)
    .all<{ page_id: string; text: string; edited: number; opened_at: number; title: string | null; position: number | null; deleted_at: number | null }>();
  const live = await loadScopePages(db, { relationshipId, userId });
  const numberOf = new Map(live.map((p, i) => [p.id, i + 1]));
  return (links.results ?? []).map((l) => ({
    page_id: l.page_id,
    number: numberOf.get(l.page_id) ?? null,
    title: l.title,
    text: l.text ?? '',
    edited: Boolean(l.edited),
  }));
}
