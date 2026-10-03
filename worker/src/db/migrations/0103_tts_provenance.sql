-- One audio pipeline (docs/AUDIO.md): every stored clip records the voice, the
-- MiniMax model and a signature of (settings + text) it was made with, so the
-- backfill can find clips made with an old voice / model / text and replace
-- them. NULL = made before this was recorded = counts as an old voice.
ALTER TABLE notes ADD COLUMN audio_voice TEXT;
ALTER TABLE notes ADD COLUMN audio_model TEXT;
ALTER TABLE notes ADD COLUMN audio_settings TEXT;
ALTER TABLE notes ADD COLUMN sentence_clue_audio_voice TEXT;
ALTER TABLE notes ADD COLUMN sentence_clue_audio_model TEXT;
ALTER TABLE notes ADD COLUMN sentence_clue_audio_settings TEXT;
ALTER TABLE note_sentences ADD COLUMN audio_voice TEXT;
ALTER TABLE note_sentences ADD COLUMN audio_model TEXT;
ALTER TABLE note_sentences ADD COLUMN audio_settings TEXT;

-- A clip MiniMax refused (bad text, a network error…) waits here before the
-- backfill tries it again, so one bad row never blocks the head of the backlog.
-- Rate limits are NOT failures and never land here.
CREATE TABLE IF NOT EXISTS tts_clip_failures (
  kind TEXT NOT NULL,              -- word | clue | sentence
  target_id TEXT NOT NULL,         -- notes.id (word, clue) or note_sentences.id
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TEXT NOT NULL,   -- ISO
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (kind, target_id)
);

CREATE INDEX IF NOT EXISTS idx_notes_audio_settings ON notes(audio_settings);
CREATE INDEX IF NOT EXISTS idx_note_sentences_audio_settings ON note_sentences(audio_settings);
