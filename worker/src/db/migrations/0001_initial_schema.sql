-- Initial database schema for Chinese Learning App

-- Users table (for future tutor feature, single implicit user for MVP)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  role TEXT DEFAULT 'student' CHECK (role IN ('student', 'tutor')),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Insert default user for MVP
INSERT INTO users (id, email, role) VALUES ('default', NULL, 'student');

-- Decks table
CREATE TABLE IF NOT EXISTS decks (
  id TEXT PRIMARY KEY,
  user_id TEXT DEFAULT 'default',
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Notes table (source of truth for vocabulary)
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL,
  hanzi TEXT NOT NULL,
  pinyin TEXT NOT NULL,
  english TEXT NOT NULL,
  audio_url TEXT,
  fun_facts TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
);

-- Cards table (generated from notes, one per card type)
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  card_type TEXT NOT NULL CHECK (card_type IN ('hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi')),
  -- SM-2 algorithm fields
  ease_factor REAL DEFAULT 2.5,
  interval INTEGER DEFAULT 0,
  repetitions INTEGER DEFAULT 0,
  next_review_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  UNIQUE(note_id, card_type)
);

-- Study sessions table
CREATE TABLE IF NOT EXISTS study_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT DEFAULT 'default',
  deck_id TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  cards_studied INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE SET NULL
);

-- Card reviews table (individual card reviews within a session)
CREATE TABLE IF NOT EXISTS card_reviews (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 0 AND rating <= 3),
  time_spent_ms INTEGER,
  user_answer TEXT,
  recording_url TEXT,
  reviewed_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES study_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_notes_deck_id ON notes(deck_id);
CREATE INDEX IF NOT EXISTS idx_cards_note_id ON cards(note_id);
CREATE INDEX IF NOT EXISTS idx_cards_next_review ON cards(next_review_at);
CREATE INDEX IF NOT EXISTS idx_card_reviews_session_id ON card_reviews(session_id);
CREATE INDEX IF NOT EXISTS idx_card_reviews_card_id ON card_reviews(card_id);
CREATE INDEX IF NOT EXISTS idx_study_sessions_user_id ON study_sessions(user_id);
