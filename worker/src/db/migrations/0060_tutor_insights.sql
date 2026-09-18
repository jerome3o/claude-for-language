-- Tutor "Student Insights": lesson log, narrative summaries and recording marks.
--
-- tutor_lesson_log      one row per lesson the tutor logs for a student. Its
--                       latest lesson_at is the default start of the insights
--                       range ("since last lesson").
-- student_summaries     persisted narrative summaries (EN + zh-CN) that Claude
--                       wrote from the structured insights for a range.
-- tutor_recording_marks the tutor's listened / needs-work mark on one of the
--                       student's pronunciation recordings (a review event).

CREATE TABLE IF NOT EXISTS tutor_lesson_log (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL,
  tutor_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  lesson_at TEXT NOT NULL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (relationship_id) REFERENCES tutor_relationships(id) ON DELETE CASCADE,
  FOREIGN KEY (tutor_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tutor_lesson_log_rel
  ON tutor_lesson_log(relationship_id, lesson_at DESC);

CREATE TABLE IF NOT EXISTS student_summaries (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL,
  range_from TEXT NOT NULL,
  range_to TEXT NOT NULL,
  narrative_en TEXT NOT NULL,
  narrative_zh TEXT NOT NULL,
  stats_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (relationship_id) REFERENCES tutor_relationships(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_student_summaries_rel
  ON student_summaries(relationship_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tutor_recording_marks (
  review_event_id TEXT PRIMARY KEY,
  tutor_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('listened', 'needs_work')),
  comment TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (review_event_id) REFERENCES review_events(id) ON DELETE CASCADE,
  FOREIGN KEY (tutor_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Every insights query is "this student's events between two timestamps";
-- the existing indexes cover (user_id, created_at) and (user_id, card_id)
-- but not reviewed_at, which is what ranges filter on.
CREATE INDEX IF NOT EXISTS idx_review_events_user_reviewed
  ON review_events(user_id, reviewed_at);
