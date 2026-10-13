-- Podcasts (docs/PODCASTS.md): subscribe to real Chinese podcasts by RSS, look at their
-- episodes, and have an episode transcribed into short segments (hanzi + pinyin + English)
-- to listen to one at a time. Not to be confused with podcast_feeds (0112), the private RSS
-- feed OF a learner's own audio lessons.

-- One row per user + feed they subscribed to.
CREATE TABLE IF NOT EXISTS podcast_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feed_url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  author TEXT,
  image_url TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, feed_url)
);
CREATE INDEX IF NOT EXISTS idx_podcast_subscriptions_user ON podcast_subscriptions(user_id, created_at);

-- The parsed feed, shared by everyone (a feed is public): refetched when older than ~30 min.
CREATE TABLE IF NOT EXISTS podcast_feed_cache (
  feed_url TEXT PRIMARY KEY,
  feed_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

-- One transcription per episode, SHARED across users (the id is a hash of feed + guid, so the
-- same episode is transcribed once whoever asks). status: queued → downloading → transcribing →
-- translating → ready | failed.
CREATE TABLE IF NOT EXISTS podcast_episodes (
  id TEXT PRIMARY KEY,
  feed_url TEXT NOT NULL,
  guid TEXT,
  enclosure_url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  podcast_title TEXT,
  published_at TEXT,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  progress TEXT,
  progress_done INTEGER,
  progress_total INTEGER,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  -- The copy of the audio we transcribed (R2 `podcast-episodes/<id>.<ext>`): the app plays THIS
  -- file, so the segments' times match it (hosts insert different ads per download).
  audio_key TEXT,
  audio_bytes INTEGER,
  audio_mime TEXT,
  duration_ms INTEGER,
  -- The Soniox async transcription being waited for, and when it was created.
  stt_job_id TEXT,
  stt_started_at TEXT,
  -- Origin of this worker for the signed audio link Soniox fetches.
  api_origin TEXT,
  -- JSON PodcastSegment[] once transcribed (translations filled in batch by batch).
  segments_json TEXT,
  provider TEXT,
  usage_json TEXT,
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_podcast_episodes_status ON podcast_episodes(status, updated_at);

-- Which user asked for (or opened) which episode — "My episodes" — and the mini lesson made from it.
CREATE TABLE IF NOT EXISTS podcast_episode_users (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL REFERENCES podcast_episodes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  lesson_status TEXT,
  lesson_id TEXT,
  lesson_error TEXT,
  lesson_from INTEGER,
  lesson_started_at TEXT,
  PRIMARY KEY (user_id, episode_id)
);
CREATE INDEX IF NOT EXISTS idx_podcast_episode_users_user ON podcast_episode_users(user_id, created_at);
