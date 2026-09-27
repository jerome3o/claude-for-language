-- Homework assignments (docs/HOMEWORK.md).
--
-- An assignment is "this deck / lesson / reader, for this student, done this
-- way, by this date": mode one_off (a single pass, not spaced repetition),
-- fsrs (long-term review — what sending a deck always did) or both. A deck
-- split over N days is N rows, each covering a slice of the student's copy
-- (item_ids). Completion comes from the student's pass events, uploaded
-- offline-first and idempotent by id; done_count / status are recomputed from
-- them. Existing homework needs no conversion: it is all long-term already.
-- (Not to be confused with the legacy reader-only homework_assignments table of
-- migration 0024, which no code uses any more and is left untouched.)
CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL,
  tutor_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  batch_id TEXT,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  source_id TEXT,
  title TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('one_off', 'fsrs', 'both')),
  due_date TEXT,
  item_ids TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  part_index INTEGER NOT NULL DEFAULT 0,
  part_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'cancelled')),
  done_count INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assignments_student ON assignments(student_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_assignments_rel ON assignments(relationship_id, created_at);
CREATE INDEX IF NOT EXISTS idx_assignments_target ON assignments(target_id);
CREATE INDEX IF NOT EXISTS idx_assignments_batch ON assignments(batch_id);

CREATE TABLE IF NOT EXISTS assignment_events (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('right', 'wrong', 'done')),
  created_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assignment_events_assignment ON assignment_events(assignment_id, created_at);

-- Lesson notes: each logged lesson gets a title, shown in the tutor's list.
ALTER TABLE tutor_lesson_log ADD COLUMN title TEXT;

-- Session-notes jobs as DRAFTS the tutor reviews before anything is sent:
-- review = 1 never auto-shares; plan = the draft plan (modes, due dates, split);
-- chat = the tutor ↔ assistant messages on the review page; assigned_at = when
-- the draft became assignments.
ALTER TABLE tutor_note_jobs ADD COLUMN review INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tutor_note_jobs ADD COLUMN plan TEXT;
ALTER TABLE tutor_note_jobs ADD COLUMN chat TEXT;
ALTER TABLE tutor_note_jobs ADD COLUMN assigned_at TEXT;
