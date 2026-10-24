-- 🎬 Clips (experimental; shared/clips, services/clips/, docs/CLIPS.md): short vertical
-- learning clips the apps PLAY from a JSON script (spec v1). One row per clip in its owner's
-- account: imported (source 'agent' via MCP / 'manual' via the API) or written by the clip
-- generator ('generated', on clip-queue: status generating → ready | failed). The clip's one
-- "Learn more → ✨ Mini lesson" is tracked on the row (lesson_status / lesson_id / lesson_error).
CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  source TEXT NOT NULL DEFAULT 'manual',
  title TEXT,
  topic TEXT,
  theme TEXT,
  spec TEXT,
  -- Generation: the request JSON { topic, words, variant, of } + progress / error / attempts.
  request TEXT,
  progress TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  lesson_status TEXT,
  lesson_id TEXT,
  lesson_error TEXT,
  lesson_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_clips_user ON clips(user_id, created_at);

-- What the learner did with a clip (views, finishes, likes / unlikes, saves / unsaves, skips,
-- double-taps, quiz answers, Learn more). id = the device's client id (idempotent upload).
-- like / save state = the latest like|unlike / save|unsave event.
CREATE TABLE IF NOT EXISTS clip_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  clip_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  value INTEGER,
  created_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_clip_events_user ON clip_events(user_id, clip_id, kind);
