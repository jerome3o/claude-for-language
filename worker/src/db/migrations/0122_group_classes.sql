-- Group classes — EXPERIMENTAL web-only prototype (docs/GROUP_CLASSES.md; shared/group,
-- routes/group-classes.ts, durable/group-room.ts). A tutor groups 2–6 of her active
-- students (each member row keeps the 1:1 relationship it came from, so nothing about a
-- group bypasses the relationship checks) and runs live group sessions in a GroupRoom
-- Durable Object. Nothing here is read by any 1:1 or student-facing flow.
CREATE TABLE IF NOT EXISTS class_groups (
  id TEXT PRIMARY KEY,
  tutor_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_class_groups_tutor ON class_groups(tutor_id);

CREATE TABLE IF NOT EXISTS class_group_members (
  group_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_class_group_members_student ON class_group_members(student_id);

-- One live class at a time per group. Times are epoch ms (like the call room's clock).
CREATE TABLE IF NOT EXISTS group_class_sessions (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  tutor_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'live',
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  -- Distinct people who entered the room (written when it ends).
  joined_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_group_class_sessions_group ON group_class_sessions(group_id, status);
