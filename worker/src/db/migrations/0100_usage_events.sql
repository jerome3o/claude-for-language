-- Usage analytics (docs/ANALYTICS.md): screen views and feature events from the web and
-- Lab apps (POST /api/analytics/events) plus server events (AI calls with tokens + cost,
-- content created, push / e-mail sent). Ids, enums and counts only — never message text,
-- card content, answers, recordings, tokens or e-mail addresses (shared/analytics/privacy.ts).
-- No foreign key: rows are pruned after 180 days by the daily cron and deleted with the account.
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  ts TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  platform TEXT NOT NULL,
  app_version TEXT,
  session_id TEXT,
  event TEXT NOT NULL,
  screen TEXT,
  props TEXT
);
CREATE INDEX IF NOT EXISTS idx_usage_events_user_ts ON usage_events(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_usage_events_event_ts ON usage_events(event, ts);
CREATE INDEX IF NOT EXISTS idx_usage_events_ts ON usage_events(ts);

-- Settings → Advanced → "Share usage data to help improve the app" (on by default).
ALTER TABLE users ADD COLUMN analytics_opt_out INTEGER NOT NULL DEFAULT 0;
