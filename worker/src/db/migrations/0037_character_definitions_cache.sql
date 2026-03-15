-- Global cache for character/vocabulary definitions (shared across all users)
CREATE TABLE IF NOT EXISTS character_definitions (
  hanzi TEXT PRIMARY KEY,
  pinyin TEXT NOT NULL,
  english TEXT NOT NULL,
  fun_facts TEXT,
  example TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
