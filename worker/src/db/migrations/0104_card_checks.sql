-- Word checks (shared/cards/check.ts, services/card-check.ts): possible issues with a note's
-- pinyin / English found by a cheap Haiku check, shown as "⚠ Possible issue" with
-- Apply fix / Dismiss — never applied automatically.
--   notes.check_issues  JSON array of NoteCheckIssue (NULL / [] = none open)
--   notes.check_at      when check_issues last changed; /api/sync/changes also returns notes
--                       changed since by this (like long_term_at), so updated_at — which the
--                       tutor → student copy rules compare — is never touched by a check
--   users.card_check    "Check new words for mistakes": NULL = default (on for tutors), 1 / 0
ALTER TABLE notes ADD COLUMN check_issues TEXT;
ALTER TABLE notes ADD COLUMN check_at TEXT;
ALTER TABLE users ADD COLUMN card_check INTEGER;

-- Per-deck "Check for errors": one run over a whole deck, its progress and the proposals
-- the tutor / learner reviews before "Apply selected". relationship_id + source_deck_id are
-- set when a tutor checks the copy of a homework deck she sent (deck_id = the student's copy).
CREATE TABLE IF NOT EXISTS deck_check_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  deck_owner_id TEXT NOT NULL,
  relationship_id TEXT,
  source_deck_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',   -- queued | running | done | failed
  total INTEGER NOT NULL DEFAULT 0,
  checked INTEGER NOT NULL DEFAULT 0,
  proposals TEXT,                          -- JSON DeckCheckProposal[]
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_deck_check_jobs_deck ON deck_check_jobs(deck_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deck_check_jobs_user ON deck_check_jobs(user_id, created_at);
