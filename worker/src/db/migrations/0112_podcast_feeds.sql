-- Private podcast feeds of audio lessons (docs/AUDIO_LESSONS.md "Podcast feed").
-- One per user: GET /api/podcast/<token>/feed.xml lists that user's ready lessons for
-- any podcast app. The token (32 random bytes, base64url) is the only credential, so it
-- is never stored in clear:
--   token_hash = SHA-256 hex of the token — how a feed request finds its user;
--   token_enc  = the token AES-GCM-encrypted with a key derived from SESSION_SECRET,
--                so Settings can show the same link again ("Copy link").
-- Reset = a new token (the old link stops working at once); turning the feed off
-- deletes the row.
CREATE TABLE IF NOT EXISTS podcast_feeds (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_enc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  rotated_at TEXT,
  last_fetched_at TEXT,
  fetch_count INTEGER NOT NULL DEFAULT 0
);
