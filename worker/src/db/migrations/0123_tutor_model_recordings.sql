-- The tutor's own recording of how a word should sound (a "model answer"), attached to a
-- needs-work mark on one of the student's pronunciation recordings (docs/RECORDING_REVIEW.md
-- "Model recordings"). R2 key under tutor-recordings/<relationshipId>/<eventId>-<id>.<ext>
-- (person-made, never collected; served only to the tutor who made it and the student by
-- GET /api/recording-marks/:eventId/model-audio). Removed with the mark, when the mark becomes
-- "listened", when replaced, and by account deletion.
ALTER TABLE tutor_recording_marks ADD COLUMN model_audio_key TEXT;
ALTER TABLE tutor_recording_marks ADD COLUMN model_audio_mime TEXT;
ALTER TABLE tutor_recording_marks ADD COLUMN model_audio_ms INTEGER;
