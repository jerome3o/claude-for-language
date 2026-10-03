-- Folders for decks, Lesson Library items and graded readers (shared/folders).
-- Organisation only: the study queue (decks.study_priority) never reads them.
-- One level of nesting (parent_id = a top-level folder of the same kind and user).
-- Items carry folder_id; NULL = Unfiled. Deleting a folder sets its items' folder_id
-- back to NULL and lifts its subfolders to the top level (services/folders.ts) —
-- no content is ever deleted with a folder. No FK constraints: the service keeps the
-- references honest (a stale folder_id shows as Unfiled on every client).
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('deck', 'lesson', 'reader')),
  name TEXT NOT NULL,
  parent_id TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_folders_user_kind ON folders(user_id, kind);

ALTER TABLE decks ADD COLUMN folder_id TEXT;
ALTER TABLE lesson_library ADD COLUMN folder_id TEXT;
ALTER TABLE graded_readers ADD COLUMN folder_id TEXT;
