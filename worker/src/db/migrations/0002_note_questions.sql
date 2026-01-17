-- Note questions table for storing Q&A with Claude about notes
CREATE TABLE IF NOT EXISTS note_questions (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  asked_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

-- Index for efficient lookup by note
CREATE INDEX IF NOT EXISTS idx_note_questions_note_id ON note_questions(note_id);
