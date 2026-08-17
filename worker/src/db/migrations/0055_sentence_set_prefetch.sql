-- Migration: background pre-generation of sentence sets + per-sentence explanations
--
-- Sets are now generated ahead of time by a queue consumer so a card is never
-- waiting on an AI call mid-study. note_sentence_jobs tracks which notes have
-- been enqueued so a note is never queued twice and a permanently failing note
-- stops being retried.

ALTER TABLE note_sentences ADD COLUMN explanation TEXT;  -- JSON: { words: [...], construction: "..." }

CREATE TABLE IF NOT EXISTS note_sentence_jobs (
  note_id TEXT PRIMARY KEY,
  -- queued | done | error
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_note_sentence_jobs_status ON note_sentence_jobs(status, updated_at);
