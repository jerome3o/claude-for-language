-- Drop the legacy reader-homework tables (migrations 0024 / 0025 / 0026).
-- Their routes, pages and queries were torn out in Aug 2026 (#321); nothing has
-- read or written them since — today's homework is assignments /
-- assignment_events (0073). The recordings they pointed at live under the
-- protected `recordings/` R2 prefix and are never collected by the storage
-- clean-up (services/admin/storage-cleanup.ts).
--
-- `notifications.homework_id` carried a foreign key to homework_assignments
-- (ON DELETE CASCADE). With foreign keys on (as on D1), dropping the parent
-- would cascade-delete those notification rows AND leave every later INSERT /
-- DELETE on notifications failing with "no such table: main.homework_assignments".
-- So notifications is rebuilt FIRST without that column (nothing reads it:
-- AppNotification has no homework_id), keeping every row and its indexes.
PRAGMA defer_foreign_keys = true;

CREATE TABLE notifications_rebuilt (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  note_id TEXT,
  conversation_id TEXT,
  relationship_id TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

INSERT INTO notifications_rebuilt (id, user_id, type, title, message, is_read, created_at, note_id, conversation_id, relationship_id)
  SELECT id, user_id, type, title, message, is_read, created_at, note_id, conversation_id, relationship_id
  FROM notifications;

DROP TABLE notifications;
ALTER TABLE notifications_rebuilt RENAME TO notifications;

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read);

-- Children first, then the parent (their indexes go with them).
DROP TABLE IF EXISTS homework_feedback;
DROP TABLE IF EXISTS homework_recordings;
DROP TABLE IF EXISTS homework_assignments;
