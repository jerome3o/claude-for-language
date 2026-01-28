-- Graded Readers table
CREATE TABLE IF NOT EXISTS graded_readers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title_chinese TEXT NOT NULL,
  title_english TEXT NOT NULL,
  difficulty_level TEXT NOT NULL,  -- 'beginner', 'elementary', 'intermediate', 'advanced'
  topic TEXT,                       -- User-specified topic
  source_deck_ids TEXT NOT NULL,    -- JSON array of deck IDs used
  vocabulary_used TEXT NOT NULL,    -- JSON array of vocabulary items used
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Reader pages (each page = one section of the story)
CREATE TABLE IF NOT EXISTS reader_pages (
  id TEXT PRIMARY KEY,
  reader_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  content_chinese TEXT NOT NULL,
  content_pinyin TEXT NOT NULL,
  content_english TEXT NOT NULL,
  image_url TEXT,                   -- R2 key for generated image
  image_prompt TEXT,                -- Prompt used to generate image
  FOREIGN KEY (reader_id) REFERENCES graded_readers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_readers_user ON graded_readers(user_id);
CREATE INDEX IF NOT EXISTS idx_reader_pages ON reader_pages(reader_id, page_number);
