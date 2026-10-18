-- 梗 Meme review (PROTOTYPE, docs/MEME_REVIEW.md, services/meme-review/).
-- ONE issue per calendar month, shared by every account: no user ids in the content.
-- The research agent's transcript is checkpointed in R2 (`agent_key`, meme-review/agent/<month>.json:
-- web search results can be large); the row keeps the status, the counters and the issue.
CREATE TABLE IF NOT EXISTS meme_issues (
  month TEXT PRIMARY KEY,                 -- 'YYYY-MM'
  status TEXT NOT NULL DEFAULT 'generating', -- generating | ready | failed
  phase TEXT NOT NULL DEFAULT 'research', -- research | illustrate (while generating)
  issue TEXT,                             -- MemeIssue JSON (shared/meme-review), written when accepted
  progress TEXT,                          -- a short "what it is doing" line
  error TEXT,
  agent_key TEXT,                         -- R2 key of the agent checkpoint
  requested_via TEXT,                     -- cron | admin | mcp
  attempts INTEGER NOT NULL DEFAULT 0,    -- deliveries that ran
  rounds INTEGER NOT NULL DEFAULT 0,      -- model calls
  searches INTEGER NOT NULL DEFAULT 0,    -- web searches used
  fetches INTEGER NOT NULL DEFAULT 0,     -- web fetches used
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  images INTEGER NOT NULL DEFAULT 0,      -- illustrations drawn
  cost_usd REAL NOT NULL DEFAULT 0,       -- estimated: tokens + searches + pictures
  generator_version INTEGER NOT NULL DEFAULT 1,
  started_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- "Make a mini lesson from this issue": a job per request, the lesson made in the CALLER's own
-- account (custom_lessons), never sent to anyone.
CREATE TABLE IF NOT EXISTS meme_review_lessons (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'generating', -- generating | ready | failed
  lesson_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_meme_review_lessons_user ON meme_review_lessons (user_id, month, created_at);
