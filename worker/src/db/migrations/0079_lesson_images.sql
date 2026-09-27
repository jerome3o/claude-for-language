-- Lesson illustrations, one per scene description (worker/src/services/lesson-images.ts).
-- A describe_image exercise's picture is keyed by a hash of its image_prompt, so
-- a tutor's library item, every student's copy and the catalogue sample that
-- share a prompt share one generated picture (R2 lesson-images/<hash>.<ext>).
-- This row says whether it exists yet: 'pending' (queued on
-- image-generation-queue), 'ready' (image_key set) or 'failed' (gave up after
-- a few attempts; retried again after a day).
CREATE TABLE IF NOT EXISTS lesson_images (
  prompt_hash TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
  image_key TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lesson_images_status ON lesson_images(status, updated_at);
