-- 成语 Idioms (beta; docs/IDIOMS.md, shared/idioms): ONE generated entry per idiom, shared
-- by every account — keyed by the normalised hanzi (normalizeIdiomHanzi). No user ids are
-- stored here, so account deletion has nothing to do.
--   status: generating | ready | failed | not_idiom
--   entry: the IdiomEntry JSON (ready only)
--   error: why it failed (failed) / the generator's reason (not_idiom)
--   suggestion: not_idiom — the idiom the text probably meant (画蛇添脚 → 画蛇添足)
--   attempts: generation attempts so far (a failed row is retried on request)
--   generator_version: IDIOM_GENERATOR_VERSION the entry was made with
--   started_at: when the current generation began (stale sweep)
--   view_count: how many times an entry was opened (any account) — for list ordering
CREATE TABLE IF NOT EXISTS idioms (
  hanzi TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'generating',
  entry TEXT,
  error TEXT,
  suggestion TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  generator_version INTEGER NOT NULL DEFAULT 1,
  started_at TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_idioms_status ON idioms(status, updated_at);
