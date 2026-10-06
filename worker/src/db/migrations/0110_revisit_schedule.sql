-- "Revisit later": mini lessons and graded readers leave FSRS for a simple gap
-- schedule (shared/study/revisit.ts). The schedule is derived from history:
-- custom_lesson_completions / reader_review_events (the ratings) plus these
-- retire / restore events ("Done for good" / "Bring back"). Offline-first: the
-- id is the client's, uploads are idempotent by id.
CREATE TABLE IF NOT EXISTS revisit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('lesson', 'reader')),
  item_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('retire', 'restore')),
  created_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_revisit_events_user ON revisit_events(user_id, item_kind, item_id);

-- The account's gaps (Settings → "Lessons & readers"): JSON RevisitSettings, NULL = defaults.
ALTER TABLE users ADD COLUMN revisit_settings TEXT;
