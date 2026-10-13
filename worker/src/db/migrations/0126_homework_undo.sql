-- Undo in the homework pass (docs/HOMEWORK.md §3b): an answer is taken back by a further
-- event `{ result: 'undo', undoes: <event id> }` — events stay append-only, so an undo made
-- offline, or arriving before / after the answer it takes back, always lands the same.
-- SQLite can't change a CHECK in place, so the table is rebuilt (nothing references it).
CREATE TABLE assignment_events_new (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('right', 'wrong', 'done', 'undo')),
  created_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT,
  undoes TEXT
);

INSERT INTO assignment_events_new (id, assignment_id, student_id, item_id, result, created_at, received_at, note)
  SELECT id, assignment_id, student_id, item_id, result, created_at, received_at, note FROM assignment_events;

DROP TABLE assignment_events;

ALTER TABLE assignment_events_new RENAME TO assignment_events;

CREATE INDEX IF NOT EXISTS idx_assignment_events_assignment ON assignment_events(assignment_id, created_at);
