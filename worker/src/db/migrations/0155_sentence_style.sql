-- "Example sentence style" (Settings → Study; shared/study/sentenceStyle.ts, docs/STUDY_SESSION.md
-- "Example sentence style"): the register the sentence-set generator writes the account's new example
-- sentences in — 'standard' (neutral, textbook-safe), 'everyday' (how people talk, the occasional common
-- colloquialism) or 'casual' (chatty spoken Chinese). NULL = the default, everyday.
ALTER TABLE users ADD COLUMN sentence_style TEXT;

-- Which style a generated sentence was written in (NULL = before this setting / the card's own sentence).
-- Recorded only; nothing reads it yet. Existing sentences are never rewritten.
ALTER TABLE note_sentences ADD COLUMN style TEXT;
