-- Quests: generated tile-map mini-games for practising imperative Chinese.
-- The whole level (map, objects, verbs, goals) lives in the `world` JSON blob,
-- which is validated against the shared quest schema before it is written.

CREATE TABLE IF NOT EXISTS quests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  topic TEXT,
  difficulty TEXT NOT NULL DEFAULT 'medium',   -- easy | medium | hard
  status TEXT NOT NULL DEFAULT 'generating',   -- generating | ready | error
  world TEXT,                                   -- QuestWorld JSON, null until ready
  error TEXT,
  completed_at TEXT,
  best_moves INTEGER,
  play_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_quests_user ON quests(user_id, created_at DESC);
