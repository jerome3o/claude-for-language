/**
 * The video-call board's pages, cached on the device so the Lesson board
 * (/connections/:relId/board) reads offline — on the train, between lessons.
 * One request (GET /api/me/board-pages) replaces the whole local copy; it runs
 * from the background sync at most every 30 minutes, and whenever the Lesson
 * board page opens online.
 */

import { db, type LocalBoardPage } from '../db/database';
import { listMyBoardPages, type BoardPageItem } from '../api/calls';

const LAST_KEY = 'board-pages-synced-at';
const EVERY_MS = 30 * 60_000;

function toLocal(p: BoardPageItem): LocalBoardPage {
  return {
    id: p.id,
    relationship_id: p.relationship_id ?? '',
    number: p.number,
    title: p.title,
    text: p.text,
    chars: p.chars,
    created_at: p.created_at,
    updated_at: p.updated_at,
    call_id: p.call_id,
  };
}

/** Fetch every page I can see and replace the device's copy. */
export async function refreshBoardPages(): Promise<void> {
  const { pages } = await listMyBoardPages();
  await db.transaction('rw', db.boardPages, async () => {
    await db.boardPages.clear();
    await db.boardPages.bulkPut(pages.map(toLocal));
  });
  try {
    localStorage.setItem(LAST_KEY, String(Date.now()));
  } catch {
    /* private mode */
  }
}

/** From the background sync: at most every 30 minutes, never throws. */
export async function syncBoardPagesIfDue(now = Date.now()): Promise<void> {
  try {
    const last = Number(localStorage.getItem(LAST_KEY) || 0);
    if (now - last < EVERY_MS) return;
    await refreshBoardPages();
  } catch (err) {
    console.warn('[board-pages] sync failed:', err);
  }
}

/** A relationship's pages from the device, in strip order. */
export async function cachedBoardPages(relationshipId: string): Promise<LocalBoardPage[]> {
  const rows = await db.boardPages.where('relationship_id').equals(relationshipId).toArray();
  return rows.sort((a, b) => a.number - b.number);
}
