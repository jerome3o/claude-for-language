/**
 * Server-side card search — the fallback behind the Decks tab search when the
 * device's IndexedDB has no (or stale) notes. Mounted under /api in index.ts.
 *
 *   GET /notes/search?q=&limit=   my notes whose hanzi / pinyin / english /
 *                                 card sentence contain q (case-insensitive),
 *                                 newest first, with the deck name
 */

import { Hono } from 'hono';
import type { Env, Note } from '../types';

const noteSearch = new Hono<{ Bindings: Env }>();

export interface NoteSearchHit extends Note {
  deck_name: string;
}

/** Strip tone marks so "yinhang" also finds "yínháng". */
function stripTones(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

noteSearch.get('/notes/search', async (c) => {
  try {
    const userId = c.get('user').id;
    const q = (c.req.query('q') || '').trim();
    if (!q) return c.json({ notes: [], total_notes: 0 });
    const limitRaw = Number(c.req.query('limit'));
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;

    const like = `%${q.toLowerCase()}%`;
    const res = await c.env.DB.prepare(
      `SELECT n.*, d.name AS deck_name
       FROM notes n JOIN decks d ON d.id = n.deck_id
       WHERE d.user_id = ?
         AND (LOWER(n.hanzi) LIKE ? OR LOWER(n.pinyin) LIKE ? OR LOWER(n.english) LIKE ? OR LOWER(COALESCE(n.sentence_clue, '')) LIKE ?)
       ORDER BY n.created_at DESC
       LIMIT ?`
    )
      .bind(userId, like, like, like, like, limit * 4)
      .all<NoteSearchHit>();
    let hits = res.results || [];

    // Pinyin typed without tones: SQLite's LOWER/LIKE cannot strip marks, so
    // widen with a second pass over the user's notes only when the plain
    // query found nothing and the query is ASCII.
    if (hits.length === 0 && /^[a-z0-9 ]+$/i.test(q)) {
      const all = await c.env.DB.prepare(
        `SELECT n.*, d.name AS deck_name FROM notes n JOIN decks d ON d.id = n.deck_id WHERE d.user_id = ? ORDER BY n.created_at DESC`
      )
        .bind(userId)
        .all<NoteSearchHit>();
      const needle = stripTones(q);
      hits = (all.results || []).filter((n) => stripTones(n.pinyin || '').includes(needle));
    }

    const total = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM notes n JOIN decks d ON d.id = n.deck_id WHERE d.user_id = ?')
      .bind(userId)
      .first<{ n: number }>();
    return c.json({ notes: hits.slice(0, limit), total_notes: total?.n ?? 0 });
  } catch (error) {
    console.error('[note-search]', error);
    return c.json({ error: 'Search failed' }, 500);
  }
});

export default noteSearch;
