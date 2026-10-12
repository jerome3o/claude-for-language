-- "Up next" (shared/decks/up-next.ts, services/up-next.ts; docs/STUDY_SESSION.md "Up next"):
-- a per-account ORDERED list of notes the learner (or their tutor) chose to be introduced
-- next. Inside the daily new-card budget the list's notes come first, in `position` order,
-- before the deck queue. One row per user + note (re-adding a removed / done row re-opens it).
-- done_at is written lazily by the server once every card of the note has a review;
-- removed_at when someone takes the note off the list by hand (the note itself is never
-- touched). Active = both NULL. added_by = who added it (the learner, or their tutor).
CREATE TABLE IF NOT EXISTS up_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  note_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  added_by TEXT,
  created_at TEXT NOT NULL,
  done_at TEXT,
  removed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_up_next_user_note ON up_next(user_id, note_id);
CREATE INDEX IF NOT EXISTS idx_up_next_user_position ON up_next(user_id, position);
