-- Word tags — the AI pass (shared/cards/word-tags-ai.ts, services/word-tags-ai.ts;
-- docs/STUDY_SESSION.md "Word tags"): what the shipped lexicon can't say about a note —
-- transitivity, a register verdict — from a cheap batched model call.
--   notes.word_tags     JSON AiWordTags { v, transitivity?, separable?, register?,
--                       register_note?, confidence } (NULL = not tagged yet)
--   notes.word_tags_at  when word_tags last changed; /api/sync/changes also returns notes
--                       changed since by this (like check_at), so updated_at — which the
--                       tutor → student copy rules compare — is never touched by tagging
ALTER TABLE notes ADD COLUMN word_tags TEXT;
ALTER TABLE notes ADD COLUMN word_tags_at TEXT;

-- The per-user backfill of untagged notes (queued from /api/sync/changes, at most
-- WORD_TAGS_BACKFILL_PER_HOUR an hour) and what the pass has cost so far.
CREATE TABLE IF NOT EXISTS word_tag_runs (
  user_id TEXT PRIMARY KEY,
  window_start TEXT,                       -- start of the current hour's window
  window_count INTEGER NOT NULL DEFAULT 0, -- notes queued by the backfill in that window
  checked_at TEXT,                         -- last time the sync looked for untagged notes
  tagged INTEGER NOT NULL DEFAULT 0,       -- notes tagged so far (all paths)
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
