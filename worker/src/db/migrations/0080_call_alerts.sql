-- Call alerts: Web Push subscriptions (the PWA / browser gets a notification when a
-- call starts while the app is closed), the account's ring setting, and a home for
-- generated app keys (the VAPID key pair when no VAPID_* secrets are configured).

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  -- The VAPID public key the browser subscribed with: a push signed with another key is refused.
  vapid_key TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_success_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

-- NULL / 'ring' = ring in the app + notifications; 'silent' = a quiet banner only, no sound, no push.
ALTER TABLE users ADD COLUMN call_alerts TEXT;

CREATE TABLE IF NOT EXISTS app_keys (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
