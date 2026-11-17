-- Sentences that use the learner's structures (docs/STUDY_SESSION.md "Listen in context").
--
-- learner_structures: per user, the grammar structures met in the mini lessons he has done
-- (shared/lesson/learnerStructures.ts), cached as JSON. `stamp` = a fingerprint of his lessons and their
-- completions; services/learner-structures.ts rebuilds the row lazily when the stamp no longer matches
-- (read by the sentence generator, which then asks for sentences using a few of them).
CREATE TABLE IF NOT EXISTS learner_structures (
  user_id TEXT PRIMARY KEY,
  structures TEXT NOT NULL,
  stamp TEXT NOT NULL,
  built_at TEXT NOT NULL
);

-- The listed structure a generated example sentence uses (its name, "除了…还…"), NULL = none.
ALTER TABLE note_sentences ADD COLUMN structure TEXT;
