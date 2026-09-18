-- A tutor's note on a recording ("second tone, not fourth") is shown to the
-- student once, on the back of that card the next time it comes up. This
-- column records when the student saw it, so it is not shown again.
ALTER TABLE tutor_recording_marks ADD COLUMN student_seen_at TEXT;
