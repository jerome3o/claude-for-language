-- Sentence Coach: which button started a conversation — check (grade my sentence),
-- explain (translation + word-by-word breakdown) or translate (English → Chinese).
-- NULL on older rows: they were check (zh) or translate (en) by input_language.
ALTER TABLE coach_conversations ADD COLUMN action TEXT;
