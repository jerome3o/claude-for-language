/**
 * A tutor's links for link homework (migration 0099, docs/HOMEWORK.md §8).
 * Made in the tutor's own account; sending one is an assignment (kind 'link').
 */

import type { CleanLinkHomework } from '@shared/homework';

export interface HomeworkLink {
  id: string;
  user_id: string;
  title: string;
  url: string;
  instructions: string | null;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface HomeworkLinkWithSends extends HomeworkLink {
  /** Students it has been sent to (assignments not cancelled). */
  sent_count: number;
}

const COLS = 'id, user_id, title, url, instructions, thumbnail_url, created_at, updated_at';

export async function getLink(db: D1Database, id: string, userId: string): Promise<HomeworkLink | null> {
  return (
    (await db.prepare(`SELECT ${COLS} FROM homework_links WHERE id = ? AND user_id = ? AND deleted_at IS NULL`).bind(id, userId).first<HomeworkLink>()) ?? null
  );
}

export async function listLinks(db: D1Database, userId: string): Promise<HomeworkLinkWithSends[]> {
  const r = await db
    .prepare(
      `SELECT ${COLS.split(', ').map((c) => `l.${c}`).join(', ')},
              (SELECT COUNT(DISTINCT a.relationship_id) FROM assignments a WHERE a.kind = 'link' AND a.source_id = l.id AND a.status != 'cancelled') AS sent_count
       FROM homework_links l WHERE l.user_id = ? AND l.deleted_at IS NULL ORDER BY l.updated_at DESC LIMIT 200`
    )
    .bind(userId)
    .all<HomeworkLinkWithSends>();
  return r.results;
}

export async function insertLink(db: D1Database, userId: string, v: CleanLinkHomework): Promise<HomeworkLink> {
  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO homework_links (id, user_id, title, url, instructions, thumbnail_url) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, userId, v.title, v.url, v.instructions, v.thumbnail_url)
    .run();
  return (await getLink(db, id, userId))!;
}

export async function updateLink(db: D1Database, id: string, userId: string, v: Partial<CleanLinkHomework>): Promise<HomeworkLink | null> {
  const current = await getLink(db, id, userId);
  if (!current) return null;
  const next = { ...current, ...v };
  await db
    .prepare(`UPDATE homework_links SET title = ?, url = ?, instructions = ?, thumbnail_url = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .bind(next.title, next.url, next.instructions, next.thumbnail_url, id, userId)
    .run();
  return getLink(db, id, userId);
}

export async function softDeleteLink(db: D1Database, id: string, userId: string): Promise<boolean> {
  const r = await db.prepare(`UPDATE homework_links SET deleted_at = datetime('now') WHERE id = ? AND user_id = ? AND deleted_at IS NULL`).bind(id, userId).run();
  return (r.meta?.changes ?? 0) > 0;
}
