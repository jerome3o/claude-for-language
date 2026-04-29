CREATE TABLE IF NOT EXISTS daily_readers (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  situation_id TEXT NOT NULL,
  reader_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, date)
);
