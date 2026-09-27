-- Per-exercise attempt data for custom mini lessons: what the learner
-- answered in each exercise and how long they spent, so a tutor can review
-- the work (typed text, chosen options, handwriting, recordings) and not
-- only the score. One row per completion — the id IS the completion event's
-- id, uploaded with it (idempotent). See shared/lesson/attempt.ts.

CREATE TABLE custom_lesson_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL REFERENCES custom_lessons(id) ON DELETE CASCADE,
  started_at TEXT,
  completed_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  correct INTEGER,
  total INTEGER,
  rating INTEGER,
  -- The lesson spec as it was when the attempt arrived, so a later edit or
  -- push-update doesn't re-label the answers.
  spec TEXT NOT NULL,
  -- LessonAttemptData JSON (exercises[] with answer + duration_ms)
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_lesson_attempts_lesson ON custom_lesson_attempts(lesson_id, completed_at);
CREATE INDEX idx_lesson_attempts_user ON custom_lesson_attempts(user_id, completed_at);

-- Recordings made during an attempt (oral expression), uploaded from the
-- device's queue after the attempt itself. media_key = shared exerciseMediaKey.
CREATE TABLE custom_lesson_attempt_media (
  attempt_id TEXT NOT NULL REFERENCES custom_lesson_attempts(id) ON DELETE CASCADE,
  media_key TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  audio_key TEXT NOT NULL,
  content_type TEXT,
  size INTEGER,
  -- 'pending' | 'done' | 'failed' | 'skipped'
  transcript_status TEXT NOT NULL DEFAULT 'pending',
  transcript TEXT,
  transcript_translation TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (attempt_id, media_key)
);
