-- Student shared decks: allows students to share their decks with tutors for progress viewing
-- This is different from tutor->student sharing which copies decks
-- Student sharing just grants view access to the existing deck

CREATE TABLE IF NOT EXISTS student_shared_decks (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  shared_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (relationship_id) REFERENCES tutor_relationships(id) ON DELETE CASCADE,
  FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE,
  UNIQUE(relationship_id, deck_id)
);

CREATE INDEX IF NOT EXISTS idx_student_shared_decks_relationship ON student_shared_decks(relationship_id);
CREATE INDEX IF NOT EXISTS idx_student_shared_decks_deck ON student_shared_decks(deck_id);
