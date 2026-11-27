-- 📺 Watch (追剧, docs/WATCH.md): Chinese TV on YouTube, played in YouTube's own embedded
-- player with a timed transcript under it. We never store or proxy any YouTube media — only the
-- video id, its title and the transcript Gemini read from the public video.

-- One transcript per YouTube video, SHARED across users (the id IS the video id).
-- status: queued → transcribing (window k of n) → translating → ready | failed.
CREATE TABLE IF NOT EXISTS watch_videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  channel TEXT,
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',
  progress TEXT,
  -- Gemini reads the video in ~5-minute windows: how many are done / planned.
  chunks_done INTEGER NOT NULL DEFAULT 0,
  chunks_total INTEGER NOT NULL DEFAULT 0,
  -- Translation progress (lines).
  progress_done INTEGER,
  progress_total INTEGER,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  -- JSON WatchChunkState[]: per window its status (pending / done / skipped), attempts, error and
  -- its raw lines — the checkpoint a redelivery resumes from.
  chunks_json TEXT,
  -- JSON WatchLine[]: the tidied lines with pinyin, English filled in batch by batch.
  lines_json TEXT,
  provider TEXT,
  model TEXT,
  usage_json TEXT,
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

-- "My videos": who added which video, and where they are in it.
CREATE TABLE IF NOT EXISTS watch_video_users (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES watch_videos(id) ON DELETE CASCADE,
  position_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_opened_at TEXT,
  PRIMARY KEY (user_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_watch_video_users_user ON watch_video_users(user_id, created_at);
