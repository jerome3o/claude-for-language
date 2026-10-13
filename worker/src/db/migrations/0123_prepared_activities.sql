-- Prepared activities (shared/call-activities/prepared.ts, services/prepared-activities.ts;
-- docs/VIDEO_CALLS.md "Prepared activities"): in-call activities written for ONE student
-- from their previous lessons, ready for the tutor's next call. The tutor's material:
-- never shown or sent to the student until the tutor starts one in a call.

-- One generation run (after a lesson report, nightly catch-up, or "Prepare activities").
-- idem_key makes a trigger idempotent: lesson:<lessonId>:<covered call ids>,
-- nightly:<relId>:<date>; a manual run gets a fresh one.
CREATE TABLE IF NOT EXISTS prepared_activity_jobs (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL,
  tutor_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  trigger TEXT NOT NULL,
  source_lesson_id TEXT,
  count INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  created_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prepared_jobs_idem ON prepared_activity_jobs(idem_key);
CREATE INDEX IF NOT EXISTS idx_prepared_jobs_rel ON prepared_activity_jobs(relationship_id, created_at);

-- One ready-to-run activity. spec_json = an ActivitySpec (validated by the shared engine).
-- status ready | used (started in a call) | dismissed (by the tutor).
CREATE TABLE IF NOT EXISTS prepared_activities (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL,
  tutor_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  source_lesson_id TEXT,
  source_label TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  why TEXT NOT NULL DEFAULT '',
  spec_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  position INTEGER NOT NULL DEFAULT 0,
  used_at TEXT,
  used_in_call_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prepared_rel ON prepared_activities(relationship_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_prepared_job ON prepared_activities(job_id);
