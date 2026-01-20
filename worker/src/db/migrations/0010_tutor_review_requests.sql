-- Tutor Review Requests
-- Students can flag cards/reviews for their tutors to review

CREATE TABLE IF NOT EXISTS tutor_review_requests (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  tutor_id TEXT NOT NULL,
  note_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  review_event_id TEXT,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'archived')),
  tutor_response TEXT,
  responded_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (relationship_id) REFERENCES tutor_relationships(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (tutor_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
  FOREIGN KEY (review_event_id) REFERENCES review_events(id) ON DELETE SET NULL
);

-- Index for tutor inbox queries
CREATE INDEX IF NOT EXISTS idx_tutor_review_requests_tutor ON tutor_review_requests(tutor_id, status, created_at);

-- Index for student sent queries
CREATE INDEX IF NOT EXISTS idx_tutor_review_requests_student ON tutor_review_requests(student_id, created_at);
