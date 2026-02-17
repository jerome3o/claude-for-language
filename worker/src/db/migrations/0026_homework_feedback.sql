-- Homework feedback: tutor feedback on student homework submissions (per-page and overall)
CREATE TABLE homework_feedback (
  id TEXT PRIMARY KEY,
  homework_id TEXT NOT NULL,
  tutor_id TEXT NOT NULL,
  page_id TEXT,
  text_feedback TEXT,
  audio_feedback_url TEXT,
  rating INTEGER,
  type TEXT NOT NULL DEFAULT 'page_feedback',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (homework_id) REFERENCES homework_assignments(id) ON DELETE CASCADE,
  FOREIGN KEY (tutor_id) REFERENCES users(id)
);

CREATE INDEX idx_homework_feedback_homework ON homework_feedback(homework_id);
CREATE INDEX idx_homework_feedback_tutor ON homework_feedback(tutor_id);
CREATE INDEX idx_homework_feedback_page ON homework_feedback(homework_id, page_id);
