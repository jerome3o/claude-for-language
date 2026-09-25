-- Card flags: a student flags one card for their tutor with a short note
-- ("I keep mixing this up with 银行"), the tutor replies, and the reply is
-- shown to the student once on the back of that card. Replaces the old
-- tutor_review_requests idea (that table stays, unused).
CREATE TABLE IF NOT EXISTS card_flags (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  tutor_id TEXT NOT NULL,
  note_id TEXT NOT NULL,
  card_id TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  tutor_reply TEXT,
  replied_at TEXT,
  student_seen_reply_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_card_flags_tutor ON card_flags(tutor_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_card_flags_student ON card_flags(student_id, created_at);
CREATE INDEX IF NOT EXISTS idx_card_flags_relationship ON card_flags(relationship_id, created_at);
CREATE INDEX IF NOT EXISTS idx_card_flags_note ON card_flags(note_id);

-- Listing a user's Ask-Claude questions newest first across all their notes.
CREATE INDEX IF NOT EXISTS idx_note_questions_asked_at ON note_questions(asked_at);
