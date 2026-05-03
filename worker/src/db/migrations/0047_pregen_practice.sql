-- Pre-generated practice sessions: content generated in the background before the user starts
-- so that clicking "Start" is instant instead of waiting for AI generation.

CREATE TABLE IF NOT EXISTS pregenerated_practice_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  grammar_point_id TEXT NOT NULL,
  exercises_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  claimed_at TEXT  -- set when the user claims this pre-gen to start a real session
);

CREATE INDEX IF NOT EXISTS idx_pregen_practice_user ON pregenerated_practice_sessions(user_id, grammar_point_id, claimed_at);
