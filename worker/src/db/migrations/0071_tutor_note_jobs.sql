-- Session notes → agent jobs. A tutor pastes free-form notes from a lesson on
-- the student's page; a Claude agent runs on tutor-notes-queue, reads the
-- student's existing cards and struggles through tools, and builds a deck of
-- standard cards (shared to the student), a mini lesson when the notes show a
-- taught structure, and a graded reader when the notes call for one.
-- The transcript is checkpointed after every round so a job survives a
-- consumer restart and resumes where it stopped.
CREATE TABLE IF NOT EXISTS tutor_note_jobs (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL,
  tutor_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  title TEXT,
  notes TEXT NOT NULL,
  lesson_at TEXT,
  priority TEXT NOT NULL DEFAULT 'core' CHECK (priority IN ('core', 'non_urgent')),
  auto_share INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  progress TEXT,
  steps TEXT NOT NULL DEFAULT '[]',
  transcript TEXT,
  rounds INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  lesson_log_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tutor_note_jobs_rel ON tutor_note_jobs(relationship_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tutor_note_jobs_tutor ON tutor_note_jobs(tutor_id, status);
