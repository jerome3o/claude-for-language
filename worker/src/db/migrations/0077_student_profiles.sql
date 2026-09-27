-- The tutor's private profile of a student (shared/students/profile.ts): what
-- kind of learner they are and what homework suits them. One row per
-- tutor_relationship, written by the tutor and NEVER shown to the student —
-- only GET|PUT /api/relationships/:relId/student-profile (tutor only) and the
-- tutor-side content agents read it. Markdown body (≤ 8000 chars) plus three
-- optional fields the agents act on directly.
CREATE TABLE IF NOT EXISTS student_profiles (
  relationship_id TEXT PRIMARY KEY,
  tutor_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  level TEXT CHECK (level IS NULL OR level IN ('beginner', 'elementary', 'intermediate', 'advanced')),
  handwriting INTEGER CHECK (handwriting IS NULL OR handwriting IN (0, 1)),
  words_per_lesson INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (relationship_id) REFERENCES tutor_relationships(id) ON DELETE CASCADE,
  FOREIGN KEY (tutor_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_student_profiles_tutor ON student_profiles(tutor_id);
