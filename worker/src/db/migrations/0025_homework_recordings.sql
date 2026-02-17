-- Homework recordings: student audio recordings for graded reader pages and voice notes
CREATE TABLE homework_recordings (
  id TEXT PRIMARY KEY,
  homework_id TEXT NOT NULL,
  page_id TEXT,
  audio_url TEXT NOT NULL,
  duration_ms INTEGER,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL DEFAULT 'page_reading',
  FOREIGN KEY (homework_id) REFERENCES homework_assignments(id) ON DELETE CASCADE
);

CREATE INDEX idx_homework_recordings_homework ON homework_recordings(homework_id);
CREATE INDEX idx_homework_recordings_page ON homework_recordings(homework_id, page_id);
