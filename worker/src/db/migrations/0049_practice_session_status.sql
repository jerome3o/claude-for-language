-- Pre-generation for grammar practice sessions: generate the next session in the background
-- so the user doesn't wait when they click "Start Practice".
-- Status: 'generating' = Claude is building exercises, 'ready' = ready to use immediately.
ALTER TABLE practice_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE practice_sessions ADD COLUMN is_pregenerated INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_practice_sessions_pregenerated
  ON practice_sessions(user_id, grammar_point_id, status, is_pregenerated);
