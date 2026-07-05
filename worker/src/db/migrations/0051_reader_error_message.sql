-- Store the reason a graded reader failed to generate so the frontend can
-- show users what actually went wrong instead of a generic "Generation failed".
ALTER TABLE graded_readers ADD COLUMN error_message TEXT;
