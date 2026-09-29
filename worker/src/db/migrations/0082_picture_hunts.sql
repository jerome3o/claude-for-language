-- Picture hunt (看图找词): a picture — uploaded or generated — with the objects
-- in it found (Gemini detection / segmentation) and named in Chinese (Claude).
-- Built on picture-hunt-queue (services/picture-hunt.ts); `progress` is the
-- breadcrumb of the stage reached, like quests.
CREATE TABLE IF NOT EXISTS picture_hunts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Picture hunt',
  source TEXT NOT NULL CHECK (source IN ('upload', 'generated')),
  -- What to draw (generated), or the learner's caption (upload).
  prompt TEXT,
  -- JSON array of deck ids whose words the picture leans toward, or NULL.
  deck_ids TEXT,
  -- R2 picture-hunts/<id>.<ext>; NULL until the picture exists.
  image_key TEXT,
  image_width INTEGER,
  image_height INTEGER,
  status TEXT NOT NULL DEFAULT 'generating' CHECK (status IN ('generating', 'ready', 'error')),
  progress TEXT,
  error TEXT,
  -- JSON HuntObject[] (shared/picture-hunt/types.ts): names + normalised geometry.
  objects TEXT,
  object_count INTEGER NOT NULL DEFAULT 0,
  -- Recomputed from picture_hunt_plays on every upload.
  best_found INTEGER,
  play_count INTEGER NOT NULL DEFAULT 0,
  last_played_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_picture_hunts_user ON picture_hunts(user_id, created_at);

-- One play-through, recorded on the device (works offline) and uploaded
-- idempotently: the id is the client's.
CREATE TABLE IF NOT EXISTS picture_hunt_plays (
  id TEXT PRIMARY KEY,
  hunt_id TEXT NOT NULL REFERENCES picture_hunts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  found_ids TEXT NOT NULL DEFAULT '[]',
  found_count INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  hints_used INTEGER NOT NULL DEFAULT 0,
  gave_up INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  played_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_picture_hunt_plays_hunt ON picture_hunt_plays(hunt_id);
CREATE INDEX IF NOT EXISTS idx_picture_hunt_plays_user ON picture_hunt_plays(user_id);
