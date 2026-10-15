-- Claude's check of a self-assessed lesson answer (shared/lesson/answerCheck.ts,
-- services/answer-check.ts; docs/STUDY_SESSION.md "Claude checks your answer"):
-- cached for everyone by SHA-256 of answerCheckCacheText (version, exercise type,
-- prompt, model answer, the learner's answer, spoken / typed, focus). No user ids:
-- the same answer to the same exercise gets the same check.
CREATE TABLE IF NOT EXISTS lesson_answer_checks (
  hash TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  exercise_type TEXT NOT NULL,
  verdict TEXT NOT NULL,
  check_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
