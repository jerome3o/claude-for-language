-- Mini lessons revise until right first time (shared/study/lessonRevision.ts, docs/STUDY_SESSION.md
-- "Mini lessons: revise until right first time"). Each finished run's OUTCOME — the scored exercises
-- it asked and the ones missed first time, as JSON { keys: ["s0e1", …], missed: [...] } — decides
-- whether the lesson is done forever or comes back a week later as a revision.
--   NULL = not known yet: derived from the run's attempt (custom_lesson_attempts, same id) on the next
--   read and written back; a run with no attempt (Sep 2026) stays NULL and its rating decides
--   (Again / Hard → a revision of the whole lesson, else done).
ALTER TABLE custom_lesson_completions ADD COLUMN outcome TEXT;
