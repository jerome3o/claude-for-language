-- Reader word chips: a page's Chinese split into words with pinyin + a short
-- gloss (shared/reader/words.ts). JSON array of { text, pinyin, gloss } whose
-- texts concatenate to content_chinese exactly; a page whose text changed no
-- longer matches and is segmented again (services/reader-words.ts).
ALTER TABLE reader_pages ADD COLUMN words TEXT;

-- "More about this word": Haiku's explanation of a word in the sentence it
-- was read in, shared by everyone (keyed by a hash of word + sentence).
CREATE TABLE IF NOT EXISTS reader_word_explanations (
  id TEXT PRIMARY KEY,
  word TEXT NOT NULL,
  sentence TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
