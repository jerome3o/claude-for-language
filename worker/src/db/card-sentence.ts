/**
 * The card's own example sentence as a note_sentences row (migration 0154, shared/study/cardSentence.ts):
 * `<note id>-card`, `is_card = 1`, position −1.
 *
 * Transition: the deprecated `notes.sentence_clue*` columns are still how the card sentence is WRITTEN (the
 * note create / update API, the MCP tools, Claude's card tools, copies, and older app builds all send those
 * fields) and the clue clip pipeline still stores its clip there. Every one of those writes goes through
 * db/queries.ts, which calls `syncCardSentences` here afterwards, so the row and the columns are always the
 * same sentence; `/api/sentences/changes` also reconciles the caller's recently changed notes before it reads
 * (a writer this file never heard of can't leave a device without its sentence). Every READER — both apps,
 * the sentence endpoints, the queue — reads the row.
 *
 * Dropping the columns later = writes go to the row directly, this file and the 'clue' clip kind go away.
 */
import { CARD_SENTENCE_SUFFIX, cardSentenceId } from '@shared/study/cardSentence';

export { cardSentenceId, CARD_SENTENCE_SUFFIX };

/** The note id of a card row's id, or null when it isn't one. */
export function noteIdOfCardSentence(id: string): string | null {
  return id.endsWith(CARD_SENTENCE_SUFFIX) && id.length > CARD_SENTENCE_SUFFIX.length
    ? id.slice(0, -CARD_SENTENCE_SUFFIX.length)
    : null;
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/**
 * Upsert the card rows of the notes matching `where` (an SQL condition on `n`, e.g. `n.id IN (?, ?)`) from the
 * notes' card-sentence columns. A row is only rewritten (and its updated_at bumped) when something differs; a
 * changed text drops its cached breakdown; a translation the row got from its breakdown is kept while the
 * note has none for the same text.
 */
function upsertSql(where: string): string {
  return `
    INSERT INTO note_sentences
      (id, note_id, position, hanzi, pinyin, translation, audio_url, audio_provider, audio_voice, audio_model,
       audio_settings, focus, focus_note, explanation, is_card, created_at, updated_at)
    SELECT n.id || '${CARD_SENTENCE_SUFFIX}', n.id, -1, TRIM(n.sentence_clue),
      NULLIF(TRIM(COALESCE(n.sentence_clue_pinyin, '')), ''),
      NULLIF(TRIM(COALESCE(n.sentence_clue_translation, '')), ''),
      n.sentence_clue_audio_url, n.sentence_clue_audio_provider, n.sentence_clue_audio_voice,
      n.sentence_clue_audio_model, n.sentence_clue_audio_settings,
      NULL, NULL, NULL, 1, ${NOW}, ${NOW}
    FROM notes n
    WHERE (${where}) AND TRIM(COALESCE(n.sentence_clue, '')) <> ''
    ON CONFLICT(id) DO UPDATE SET
      explanation = CASE WHEN note_sentences.hanzi = excluded.hanzi THEN note_sentences.explanation ELSE NULL END,
      translation = CASE WHEN excluded.translation IS NULL AND note_sentences.hanzi = excluded.hanzi
                         THEN note_sentences.translation ELSE excluded.translation END,
      hanzi = excluded.hanzi,
      pinyin = excluded.pinyin,
      audio_url = excluded.audio_url,
      audio_provider = excluded.audio_provider,
      audio_voice = excluded.audio_voice,
      audio_model = excluded.audio_model,
      audio_settings = excluded.audio_settings,
      position = -1,
      is_card = 1,
      updated_at = excluded.updated_at
    WHERE note_sentences.hanzi IS NOT excluded.hanzi
       OR note_sentences.pinyin IS NOT excluded.pinyin
       OR (excluded.translation IS NOT NULL AND note_sentences.translation IS NOT excluded.translation)
       OR (excluded.translation IS NULL AND note_sentences.hanzi IS NOT excluded.hanzi)
       OR note_sentences.audio_url IS NOT excluded.audio_url
       OR note_sentences.audio_provider IS NOT excluded.audio_provider
       OR note_sentences.audio_settings IS NOT excluded.audio_settings
       OR note_sentences.position != -1
       OR note_sentences.is_card != 1`;
}

/** Card rows of matching notes whose card sentence was removed. Their other rows are touched first (whole-set sync). */
function removedSql(where: string): { touch: string; remove: string } {
  const gone = `SELECT c.note_id FROM note_sentences c JOIN notes n ON n.id = c.note_id
                 WHERE c.is_card = 1 AND (${where}) AND TRIM(COALESCE(n.sentence_clue, '')) = ''`;
  return {
    touch: `UPDATE note_sentences SET updated_at = ${NOW} WHERE is_card = 0 AND note_id IN (${gone})`,
    remove: `DELETE FROM note_sentences WHERE is_card = 1 AND note_id IN (${gone})`,
  };
}

/** A set row saying exactly the card sentence is merged into the card row (the card row stays, its twin goes). */
function dedupeSql(where: string): string {
  return `DELETE FROM note_sentences
    WHERE is_card = 0
      AND note_id IN (SELECT n.id FROM notes n WHERE ${where})
      AND EXISTS (SELECT 1 FROM note_sentences c
                   WHERE c.id = note_sentences.note_id || '${CARD_SENTENCE_SUFFIX}' AND c.is_card = 1
                     AND c.hanzi = note_sentences.hanzi)`;
}

/** The statements that make the card rows of the notes matching `where` equal their notes' card sentence. */
export function cardSentenceStatements(db: D1Database, where: string, params: unknown[]): D1PreparedStatement[] {
  const removed = removedSql(where);
  return [
    db.prepare(upsertSql(where)).bind(...params),
    db.prepare(removed.touch).bind(...params),
    db.prepare(removed.remove).bind(...params),
    db.prepare(dedupeSql(where)).bind(...params),
  ];
}

/** Bound parameters per statement are capped (D1: 100); notes go in chunks. */
const CHUNK = 80;

/** Make these notes' card rows match their card sentence (after any write to the `sentence_clue*` columns). */
export async function syncCardSentences(db: D1Database, noteIds: Array<string | null | undefined>): Promise<void> {
  const ids = Array.from(new Set(noteIds.filter((id): id is string => !!id)));
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const where = `n.id IN (${chunk.map(() => '?').join(', ')})`;
    await db.batch(cardSentenceStatements(db, where, chunk));
  }
}

/**
 * The reconciliation `/api/sentences/changes` runs before it reads: every note of the user changed since
 * `since` (all of them with no cursor). Writes nothing when the rows already match.
 */
export async function reconcileCardSentencesForUser(db: D1Database, userId: string, since: string | null): Promise<void> {
  const where = since
    ? 'n.deck_id IN (SELECT id FROM decks WHERE user_id = ?) AND datetime(n.updated_at) >= datetime(?)'
    : 'n.deck_id IN (SELECT id FROM decks WHERE user_id = ?)';
  await db.batch(cardSentenceStatements(db, where, since ? [userId, since] : [userId]));
}
