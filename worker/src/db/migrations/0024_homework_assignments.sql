-- Homework assignments: tutors assign graded readers to students
CREATE TABLE homework_assignments (
  id TEXT PRIMARY KEY,
  tutor_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  reader_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'assigned',
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  notes TEXT,
  FOREIGN KEY (tutor_id) REFERENCES users(id),
  FOREIGN KEY (student_id) REFERENCES users(id),
  FOREIGN KEY (reader_id) REFERENCES graded_readers(id)
);

CREATE INDEX idx_homework_tutor ON homework_assignments(tutor_id);
CREATE INDEX idx_homework_student ON homework_assignments(student_id);
CREATE INDEX idx_homework_reader ON homework_assignments(reader_id);
