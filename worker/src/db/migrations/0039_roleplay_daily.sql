-- Daily roleplay scenarios + activity tracking
-- Prototype tables — safe to drop/recreate while iterating (flashcard data is untouched)

CREATE TABLE IF NOT EXISTS roleplay_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  situation_id TEXT NOT NULL,
  scenario TEXT NOT NULL,
  ai_role TEXT NOT NULL,
  user_role TEXT NOT NULL,
  goal TEXT NOT NULL,
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_roleplay_sessions_user ON roleplay_sessions(user_id, started_at);

CREATE TABLE IF NOT EXISTS roleplay_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,              -- 'ai' | 'user'
  hanzi TEXT NOT NULL,
  pinyin TEXT,
  english TEXT,
  revealed INTEGER DEFAULT 0,      -- user tapped to see hanzi/english instead of replying from audio alone
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES roleplay_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_roleplay_messages_session ON roleplay_messages(session_id, created_at);

-- One row per (user, activity, local-ish date) to drive the homepage done-ticks
CREATE TABLE IF NOT EXISTS daily_activities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  activity TEXT NOT NULL,          -- 'reader' | 'roleplay'
  ref_id TEXT,
  completed_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_daily_activities_user ON daily_activities(user_id, completed_at);
