/**
 * The learner block of a Claude chat turn (prompt.ts): what Claude knows about the learner on every
 * turn, from the LEARNER's own rows only — today a sample of the words they have started. Never the
 * tutor's private profile (`student_profiles`) or anything else a tutor wrote about them.
 */
import { ASK_KNOWN_WORDS_MAX } from './persona';

/** A day's seed for one learner (FNV-1a of user id + UTC date, below KNOWN_WORDS_MOD). */
export function knownWordsSeed(userId: string, day: string): number {
  let h = 0x811c9dc5;
  for (const ch of `${userId}|${day}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % KNOWN_WORDS_MOD;
}

const KNOWN_WORDS_MOD = 1_000_003;

/**
 * A sample of the words the learner has started (hanzi of notes with a reviewed card, 1–4
 * characters) — the Chinese answer leans on them. DETERMINISTIC per user and UTC day (the
 * notes ordered by a seeded mix of their rowid), so the system block holding it is the same
 * for every ask of the day and stays in the prompt cache; a new day brings a new sample.
 */
export function knownWordsStatement(db: D1Database, userId: string, day = new Date().toISOString().slice(0, 10), limit = ASK_KNOWN_WORDS_MAX): D1PreparedStatement {
  return db
    .prepare(
      `SELECT n.hanzi FROM notes n JOIN decks d ON d.id = n.deck_id
        WHERE d.user_id = ? AND length(n.hanzi) BETWEEN 1 AND 4
          AND EXISTS (SELECT 1 FROM cards c WHERE c.note_id = n.id AND c.queue != 0)
        ORDER BY (n.rowid * 2654435761 + ?) % ${KNOWN_WORDS_MOD}, n.id LIMIT ?`,
    )
    .bind(userId, knownWordsSeed(userId, day), limit);
}

/** The known-words sample on its own (see `knownWordsStatement`). Empty on any failure. */
export async function sampleKnownWords(db: D1Database, userId: string, limit = ASK_KNOWN_WORDS_MAX): Promise<string[]> {
  try {
    const rows = await knownWordsStatement(db, userId, undefined, limit).all<{ hanzi: string }>();
    return (rows.results ?? []).map((r) => r.hanzi).filter(Boolean);
  } catch (err) {
    console.error('[ask] known words sample failed:', err instanceof Error ? err.message : err);
    return [];
  }
}
