-- Lesson library + editor: tutors keep master copies of mini lessons in a
-- library and assign them to students; the editor (student or tutor) has a
-- Claude side-chat whose proposals are stored per message.
--
-- Library model = copy with link back. Assigning creates a real
-- custom_lessons row for the student (works offline, student may edit) that
-- remembers which library item and tutor it came from, so the tutor can see
-- per-student results and push updates to the copies (same ids → completion
-- history and FSRS schedule survive).

ALTER TABLE custom_lessons ADD COLUMN library_item_id TEXT;
ALTER TABLE custom_lessons ADD COLUMN assigned_by TEXT;
ALTER TABLE custom_lessons ADD COLUMN assigned_relationship_id TEXT;

CREATE INDEX idx_custom_lessons_library_item ON custom_lessons(library_item_id);
CREATE INDEX idx_custom_lessons_assigned_by ON custom_lessons(assigned_by);

CREATE TABLE lesson_library (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  -- Full CustomLessonSpec JSON (shared/lesson)
  spec TEXT NOT NULL,
  -- JSON array of strings
  tags TEXT NOT NULL DEFAULT '[]',
  -- Bumped on every spec change; assigned copies record the version they got
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE INDEX idx_lesson_library_owner ON lesson_library(owner_id, archived_at);

-- One chat per (person, thing being edited). target_type is free text so a
-- later kind of editor (e.g. 'reader') needs no migration.
CREATE TABLE editor_chats (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'lesson' (a custom_lessons row) | 'library' (a lesson_library row) | ...
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_editor_chats_target ON editor_chats(owner_id, target_type, target_id);

CREATE TABLE editor_chat_messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES editor_chats(id) ON DELETE CASCADE,
  -- 'user' | 'assistant'
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  -- The spec as the editor held it when this message was sent — the next
  -- message diffs against it to tell Claude what the author changed since.
  spec_snapshot TEXT,
  -- Assistant proposals: the full revised spec, and what the author did with it
  proposed_spec TEXT,
  -- 'pending' | 'accepted' | 'rejected' (NULL when there is no proposal)
  proposal_status TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_editor_chat_messages_chat ON editor_chat_messages(chat_id, created_at);
