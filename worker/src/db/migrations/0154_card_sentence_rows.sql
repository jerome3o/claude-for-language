-- The card's own example sentence becomes one of the note's note_sentences rows
-- (docs/STUDY_SESSION.md "Example sentences — one model"; shared/study/cardSentence.ts).
--
-- Before: notes.sentence_clue / _pinyin / _translation / _audio_* held "the card sentence" and every
-- reader (study card, Sentence round, Listen in context, explain / translation caches, audio, exports)
-- special-cased it next to the generated set in note_sentences. Now it is a note_sentences row like
-- every other, flagged is_card = 1, with a deterministic id (`<note id>-card`, so a device can make the
-- same row from a note it cached before this migration) and position -1 (it sorts first; the set keeps
-- 0..n). Its clip is the SAME R2 key the note already had — nothing is regenerated.
--
-- The notes.sentence_clue* columns stay for now as a mirror for older app builds and the MCP / API
-- inputs: the worker keeps the row and the columns identical (worker/src/db/card-sentence.ts). They can
-- be dropped once no supported build reads them (see CLAUDE.md "Card sentence").
--
-- Idempotent: INSERT OR IGNORE on the deterministic id; the dedupe only removes a set row whose text is
-- exactly the card row's (its cached breakdown is carried onto the card row first).

ALTER TABLE note_sentences ADD COLUMN is_card INTEGER NOT NULL DEFAULT 0;

-- One card row per note that has a card sentence. Pinyin / translation / breakdown fall back to a set
-- row with the same text when the note has none (a row the generator once repeated).
INSERT OR IGNORE INTO note_sentences
  (id, note_id, position, hanzi, pinyin, translation, audio_url, audio_provider, audio_voice, audio_model,
   audio_settings, focus, focus_note, explanation, is_card, created_at, updated_at)
SELECT
  n.id || '-card',
  n.id,
  -1,
  TRIM(n.sentence_clue),
  COALESCE(NULLIF(TRIM(COALESCE(n.sentence_clue_pinyin, '')), ''),
    (SELECT s.pinyin FROM note_sentences s WHERE s.note_id = n.id AND s.hanzi = TRIM(n.sentence_clue) AND s.pinyin IS NOT NULL LIMIT 1)),
  COALESCE(NULLIF(TRIM(COALESCE(n.sentence_clue_translation, '')), ''),
    (SELECT s.translation FROM note_sentences s WHERE s.note_id = n.id AND s.hanzi = TRIM(n.sentence_clue) AND s.translation IS NOT NULL LIMIT 1)),
  n.sentence_clue_audio_url,
  n.sentence_clue_audio_provider,
  n.sentence_clue_audio_voice,
  n.sentence_clue_audio_model,
  n.sentence_clue_audio_settings,
  NULL,
  NULL,
  (SELECT s.explanation FROM note_sentences s WHERE s.note_id = n.id AND s.hanzi = TRIM(n.sentence_clue) AND s.explanation IS NOT NULL LIMIT 1),
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM notes n
WHERE TRIM(COALESCE(n.sentence_clue, '')) <> '';

-- A set row repeating the card sentence word for word is merged into the card row (above), not kept twice.
DELETE FROM note_sentences
WHERE is_card = 0
  AND EXISTS (
    SELECT 1 FROM note_sentences c
    WHERE c.id = note_sentences.note_id || '-card' AND c.is_card = 1 AND c.hanzi = note_sentences.hanzi
  );

-- Every row of a note that has a card row travels with it on the next sentence sync: devices replace a
-- note's rows with the ones a sync hands them, so a note must never arrive as its card row alone.
UPDATE note_sentences
SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE is_card = 0 AND note_id IN (SELECT note_id FROM note_sentences WHERE is_card = 1);

CREATE INDEX IF NOT EXISTS idx_note_sentences_card ON note_sentences(note_id, is_card);
