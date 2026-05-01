-- Audio lessons: generated MP3 files for offline listening practice

CREATE TABLE IF NOT EXISTS audio_lessons (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  deck_id TEXT,
  lesson_note_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | generating | done | error
  audio_key TEXT,                          -- R2 key when done
  duration_seconds INTEGER,               -- approximate duration
  segment_count INTEGER,                  -- number of audio segments
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE SET NULL,
  FOREIGN KEY (lesson_note_id) REFERENCES lesson_notes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audio_lessons_user ON audio_lessons(user_id, created_at DESC);
