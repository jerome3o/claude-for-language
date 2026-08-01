-- Reader review events: graded readers join the FSRS rotation.
-- Same event-sourced model as review_events, but readers aren't cards
-- (review_events.card_id has a FK to cards), so they get their own table.
CREATE TABLE IF NOT EXISTS reader_review_events (
  id TEXT PRIMARY KEY,
  reader_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 0 AND rating <= 3),
  time_spent_ms INTEGER,
  reviewed_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (reader_id) REFERENCES graded_readers(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- For syncing events by user since timestamp
CREATE INDEX IF NOT EXISTS idx_reader_review_events_sync ON reader_review_events(user_id, created_at);

-- For computing a reader's state from its history
CREATE INDEX IF NOT EXISTS idx_reader_review_events_reader ON reader_review_events(reader_id, reviewed_at);
