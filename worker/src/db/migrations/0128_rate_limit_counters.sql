-- Per-user hourly counters for the cost guard (middleware/cost-guard.ts): job-creating
-- POSTs (audio lessons, readers, picture hunts, quests, podcast episodes, session notes)
-- are limited to 30 an hour. The Workers rate-limit bindings only count 10 s / 60 s
-- windows, so the hour lives here: one row per key ('jobs:<user id>'), a fixed window
-- (epoch hour) and its count. Tiny; rows are overwritten in place.
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
