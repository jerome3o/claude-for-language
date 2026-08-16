-- Migration: Sentence sets — a graded list of example sentences per note
--
-- The existing single `sentence_clue` on notes stays as-is (it's the one shown
-- inline on the study card). This table holds a richer *set* of sentences for a
-- word, ordered by increasing difficulty and deliberately varied: some use
-- characters the target word shares, some contrast it with an easily-confused
-- word, some show common collocations. Each row can carry its own TTS clip so
-- the whole set works offline.

CREATE TABLE IF NOT EXISTS note_sentences (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  -- 0-based ordering within the set; also the difficulty ramp (0 = simplest)
  position INTEGER NOT NULL,
  hanzi TEXT NOT NULL,
  pinyin TEXT,
  translation TEXT,
  audio_url TEXT,
  -- Why this sentence is in the set: core | shared_character | contrast |
  -- collocation | complex
  focus TEXT,
  -- Short learner-facing note explaining the relationship (e.g. "明白 shares 明")
  focus_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_note_sentences_note ON note_sentences(note_id, position);
CREATE INDEX IF NOT EXISTS idx_note_sentences_updated ON note_sentences(updated_at);
