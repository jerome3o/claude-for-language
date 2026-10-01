import { knownCountsFromTiers, type KnownCounts } from '@shared/progress/known';

export interface KnownCountsSummary {
  characters: KnownCounts;
  words: KnownCounts;
  sentences: KnownCounts;
}

/**
 * "Characters known" / "Words known" for the tutor's view of a student — the same
 * definitions as the student's Progress page (shared/progress/known.ts), but from the
 * server's cached card state (queue / stability, kept in step with the review events on
 * every upload) instead of a replay of every event, so it is one cheap query.
 */
export async function getKnownCounts(db: D1Database, userId: string): Promise<KnownCountsSummary> {
  const rows = await db.prepare(`
    SELECT n.hanzi AS hanzi,
      MAX(CASE WHEN c.queue = 2 AND c.stability > 21 THEN 2 WHEN c.queue != 0 THEN 1 ELSE 0 END) AS tier
    FROM notes n
    JOIN decks d ON d.id = n.deck_id
    JOIN cards c ON c.note_id = n.id
    WHERE d.user_id = ?
    GROUP BY n.id
  `).bind(userId).all<{ hanzi: string; tier: number }>();
  return knownCountsFromTiers(rows.results ?? []);
}
