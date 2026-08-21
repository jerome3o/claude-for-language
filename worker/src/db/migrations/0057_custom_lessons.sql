-- Custom mini lessons: agent-authored, schema-driven lessons (see
-- shared/lesson). The spec column holds the full CustomLessonSpec JSON —
-- sections of exercises in any order. Completions are idempotent client
-- events (same pattern as grammar practice offline completions).

CREATE TABLE custom_lessons (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  spec TEXT NOT NULL,
  -- who authored it: 'mcp' (external agent) | 'chat' (in-app Ask Claude) | 'api'
  source TEXT NOT NULL DEFAULT 'api',
  -- 'active' (waiting in the study queue) | 'done' (completed once)
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_custom_lessons_user_status ON custom_lessons(user_id, status);

CREATE TABLE custom_lesson_completions (
  -- Client-generated event id; INSERT OR IGNORE makes re-uploads no-ops
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL REFERENCES custom_lessons(id) ON DELETE CASCADE,
  correct INTEGER NOT NULL,
  total INTEGER NOT NULL,
  completed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_custom_lesson_completions_user ON custom_lesson_completions(user_id);
