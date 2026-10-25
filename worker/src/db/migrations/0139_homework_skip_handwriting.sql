-- "Skip this homework" and "Skip handwriting exercises" (docs/HOMEWORK.md §3d,
-- docs/STUDY_SESSION.md "Skip handwriting").
--
-- 1. A student may skip a tutor's homework: a further pass event `{ result: 'skip' }`
--    (an `undo` takes it back, like an answer). The assignment keeps its status;
--    `skipped_at` = the live skip event's time (NULL = not skipped), recomputed with
--    done_count / status. The tutor's views say "Skipped by <student>"; nothing of hers
--    is deleted. SQLite can't change a CHECK in place, so the events table is rebuilt
--    (nothing references it), as in 0126.
-- 2. users.skip_handwriting: 1 = leave write_handwriting exercises out of mini lessons and
--    type handwritten dictation (NULL / 0 = off).
ALTER TABLE assignments ADD COLUMN skipped_at TEXT;

ALTER TABLE users ADD COLUMN skip_handwriting INTEGER;

CREATE TABLE assignment_events_new (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('right', 'wrong', 'done', 'undo', 'skip')),
  created_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT,
  undoes TEXT
);

INSERT INTO assignment_events_new (id, assignment_id, student_id, item_id, result, created_at, received_at, note, undoes)
  SELECT id, assignment_id, student_id, item_id, result, created_at, received_at, note, undoes FROM assignment_events;

DROP TABLE assignment_events;

ALTER TABLE assignment_events_new RENAME TO assignment_events;

CREATE INDEX IF NOT EXISTS idx_assignment_events_assignment ON assignment_events(assignment_id, created_at);
