-- Practice per example sentence (shared/study/sentenceHistory.ts, services/sentence-practice.ts;
-- docs/STUDY_SESSION.md "Sentence practice history"). Every 🎤 take on an example sentence (the
-- Sentence round, the answer side's rows) is an event — sentence, mode read | translate, result right |
-- close | wrong, when — and so are "Stop showing this sentence" (hide + reason) and "Show again"
-- (unhide). Like review_events they are the truth: id = the client's id (idempotent upload); each device
-- folds them into per-sentence stats (sentenceStats). sentence_key = the set row's id, or 'clue' for the
-- note's own sentence_clue. received_at = the server's clock, the sync cursor.
CREATE TABLE IF NOT EXISTS sentence_practice_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  note_id TEXT NOT NULL,
  sentence_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  mode TEXT,
  result TEXT,
  reason TEXT,
  at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_sentence_practice_user ON sentence_practice_events(user_id, received_at);
CREATE INDEX IF NOT EXISTS idx_sentence_practice_note ON sentence_practice_events(note_id, sentence_key);
