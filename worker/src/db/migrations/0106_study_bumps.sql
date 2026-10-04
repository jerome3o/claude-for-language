-- "⚡ Study it today" (shared/decks/bumps.ts, services/study-bumps.ts): a per-account
-- pocket of notes the learner already had and bumped to the front of today's study.
-- One row per user + note (a re-bump of a finished / cleared row re-opens it with a
-- fresh created_at). Clients derive which cards are in the pocket from their own
-- review events (reviews at or after created_at cover a card); done_at is written
-- lazily by the server once every bumped card has been reviewed since the bump,
-- cleared_at when the learner takes the word out by hand. Active = both NULL.
-- bumped_by = who bumped it (the learner, or their tutor).
CREATE TABLE IF NOT EXISTS study_bumps (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  note_id TEXT NOT NULL,
  source TEXT,
  bumped_by TEXT,
  created_at TEXT NOT NULL,
  done_at TEXT,
  cleared_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_study_bumps_user_note ON study_bumps(user_id, note_id);
