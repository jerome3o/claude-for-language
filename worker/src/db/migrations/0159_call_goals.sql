-- 🎯 Structures to use in a video call (docs/VIDEO_CALLS.md "Structures to use", shared/calls/goals.ts).
-- One row per structure per call, written by the CallRoom when someone leaves and when the call ends
-- (the whole call's list replaces the rows of that call). The review page and the lesson report read
-- them per lesson; the next call's pick prefers structures the student hasn't `used` yet.
CREATE TABLE IF NOT EXISTS call_goals (
  id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  lesson_id TEXT,
  relationship_id TEXT,
  -- Whose speech ticked them (the relationship's student; the caller in a solo call).
  student_id TEXT,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  -- JSON CallGoal (line, meaning, example, fixed words, source, used / near sentences).
  goal_json TEXT NOT NULL,
  -- open | checking | used | near
  status TEXT NOT NULL,
  used_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (call_id, id)
);

CREATE INDEX IF NOT EXISTS idx_call_goals_lesson ON call_goals(lesson_id);
CREATE INDEX IF NOT EXISTS idx_call_goals_student ON call_goals(student_id, status);
