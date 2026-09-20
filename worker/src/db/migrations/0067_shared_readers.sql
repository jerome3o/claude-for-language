-- Tutor → student sharing of graded readers. Modelled on shared_decks: the
-- tutor's reader is copied into the student's account (new reader + page ids)
-- and this row links the two. Page illustrations are NOT copied: both copies
-- reference the same R2 key, so an image is only deleted from R2 once no
-- reader page references it any more (see services/shared-readers.ts).
CREATE TABLE IF NOT EXISTS shared_readers (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL,
  source_reader_id TEXT NOT NULL,
  target_reader_id TEXT NOT NULL,
  shared_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (relationship_id) REFERENCES tutor_relationships(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shared_readers_relationship ON shared_readers(relationship_id, shared_at);
CREATE INDEX IF NOT EXISTS idx_shared_readers_source ON shared_readers(source_reader_id);
CREATE INDEX IF NOT EXISTS idx_shared_readers_target ON shared_readers(target_reader_id);
