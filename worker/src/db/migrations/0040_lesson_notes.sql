-- Free-form lesson notes from an external tutor (raw text, used as generation context)

CREATE TABLE IF NOT EXISTS lesson_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  given_at TEXT,                 -- free-form ("Tue lesson", "2026-04-28")
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lesson_notes_user ON lesson_notes(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lesson_note_files (
  id TEXT PRIMARY KEY,
  lesson_note_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT,
  size INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (lesson_note_id) REFERENCES lesson_notes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lesson_note_files_note ON lesson_note_files(lesson_note_id);
