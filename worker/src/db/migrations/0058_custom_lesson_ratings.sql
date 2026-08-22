-- Custom mini lessons join the FSRS rotation: each completion now carries the
-- learner's Again/Hard/Good/Easy rating (0-3), and the client computes the
-- lesson's scheduling state from its completion history — the same
-- event-sourced model as cards and readers. NULL rating = legacy one-shot
-- completion, treated as Good when computing state.
--
-- Lessons therefore no longer retire on completion; the status column stays
-- for legacy rows but is no longer written by the completion path.

ALTER TABLE custom_lesson_completions ADD COLUMN rating INTEGER;
