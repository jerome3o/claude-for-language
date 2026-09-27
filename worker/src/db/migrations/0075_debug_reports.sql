-- Study-state debug reports (shared/debug/report.ts): the web app and the native
-- Lab app each upload a snapshot of what they think is due and why, so the two
-- can be diffed (GET /api/debug/compare). The JSON itself (up to a few MB: one
-- row per card, one hash per review event) lives in R2 under
-- debug/<user_id>/<id>.json; this is the small index. Pruned to the newest 20
-- per user + client on upload.
CREATE TABLE IF NOT EXISTS debug_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client TEXT NOT NULL CHECK (client IN ('lab', 'web')),
  app_version TEXT,
  install_kind TEXT,
  r2_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_debug_reports_user ON debug_reports(user_id, client, created_at);
