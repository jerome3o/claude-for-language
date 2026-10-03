-- In-call activities (shared/call-activities; docs/VIDEO_CALLS.md "In-call activities"):
-- one row per activity session played in a call, with its readable summary
-- (ActivitySummary JSON). Written by the CallRoom when a session finishes, is
-- closed, replaced, or when people leave / the call ends (upsert by session id).
-- No foreign keys, like the other call tables (account deletion removes them).
CREATE TABLE IF NOT EXISTS call_activities (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL,
  lesson_id TEXT,
  relationship_id TEXT,
  activity_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  started_by TEXT,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  summary_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_call_activities_call ON call_activities(call_id, started_at);
CREATE INDEX IF NOT EXISTS idx_call_activities_lesson ON call_activities(lesson_id);
