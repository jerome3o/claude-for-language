-- Homework library + link homework (docs/HOMEWORK.md §8–10).
--
-- homework_links: a tutor's links (YouTube video, song, drama clip, article),
-- made in HER account first; nothing reaches a student until she sends one
-- (an assignment kind 'link'). Soft-deleted so sent homework keeps its row.
CREATE TABLE IF NOT EXISTS homework_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  instructions TEXT,
  thumbnail_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_homework_links_user ON homework_links(user_id, deleted_at, updated_at);

-- An assignment's extra fields as JSON ({ url, instructions, thumbnail_url } for a link):
-- a snapshot, so editing / deleting the tutor's link never breaks sent homework.
ALTER TABLE assignments ADD COLUMN details TEXT;

-- The student's optional note back to the tutor on a `done` event (link homework).
ALTER TABLE assignment_events ADD COLUMN note TEXT;
