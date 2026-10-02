-- Crash / freeze reports sent the moment they happen (services/crash-reports.ts): the Lab
-- app's uncaught-exception handler, its main-thread freeze watchdog and, at the next start,
-- Android's exit records (ANR thread dumps, native crashes). Idempotent by (user_id, id).
CREATE TABLE IF NOT EXISTS crash_reports (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  client TEXT NOT NULL,
  app_version TEXT,
  device TEXT,
  source TEXT NOT NULL,
  reason TEXT,
  thread TEXT,
  description TEXT,
  trace TEXT,
  occurred_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_crash_reports_user ON crash_reports(user_id, created_at);
