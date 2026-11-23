-- Feedback while listening (docs/AUDIO_LESSONS.md "Feedback while listening", shared/audio-lesson/feedback.ts):
-- one row per "Too hard" / back a section / next section press on an audio lesson — from the lock screen,
-- the media notification, a headset button or the player. Written by the learner's devices (client id,
-- idempotent), read by Claude through MCP get_audio_lesson_feedback to see which lines were hard.
CREATE TABLE IF NOT EXISTS audio_lesson_feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  audio_lesson_id TEXT NOT NULL REFERENCES audio_lessons(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- too_hard | back_section | again | skip
  source TEXT,                   -- lock_screen | notification | player | headset
  position_ms INTEGER NOT NULL,
  chapter_index INTEGER,
  row_index INTEGER,             -- the transcript row playing when pressed (transcriptRows), -1 before the first
  row_json TEXT,                 -- { index, start_ms, text, pinyin?, english? } of that row
  previous_row_json TEXT,        -- …and of the row before it (reaction lag)
  speed REAL,
  audio_version TEXT,
  created_at TEXT NOT NULL,      -- when pressed (device clock)
  received_at TEXT NOT NULL      -- when the server got it (the ?since= cursor)
);

CREATE INDEX IF NOT EXISTS idx_audio_lesson_feedback_user ON audio_lesson_feedback(user_id, received_at);
CREATE INDEX IF NOT EXISTS idx_audio_lesson_feedback_lesson ON audio_lesson_feedback(audio_lesson_id, created_at);
