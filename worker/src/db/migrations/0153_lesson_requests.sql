-- ＋ Add tab (docs/ADD_TAB.md): "🎯 Mini lesson" — the learner says what a lesson should practise and
-- Claude writes it in the background (services/lesson-requests.ts, on coach-reply-queue). One row per
-- request: status generating → ready (lesson_id = the custom_lessons row in his account) | failed.
CREATE TABLE IF NOT EXISTS lesson_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'generating',
  lesson_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lesson_requests_user ON lesson_requests(user_id, created_at);
