-- Tutor-Student Relationships
-- Enable many-to-many tutor-student relationships where users can be tutors to some people and students to others

-- Tutor-Student Pairings
CREATE TABLE IF NOT EXISTS tutor_relationships (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  requester_role TEXT NOT NULL CHECK (requester_role IN ('tutor', 'student')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'removed')),
  created_at TEXT DEFAULT (datetime('now')),
  accepted_at TEXT,
  FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(requester_id, recipient_id)
);

-- Conversations between tutor and student
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL,
  title TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  last_message_at TEXT,
  FOREIGN KEY (relationship_id) REFERENCES tutor_relationships(id) ON DELETE CASCADE
);

-- Messages within a conversation
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Shared Decks (tutor copies deck to student)
CREATE TABLE IF NOT EXISTS shared_decks (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL,
  source_deck_id TEXT NOT NULL,
  target_deck_id TEXT NOT NULL,
  shared_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (relationship_id) REFERENCES tutor_relationships(id) ON DELETE CASCADE
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_tutor_rel_requester ON tutor_relationships(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_tutor_rel_recipient ON tutor_relationships(recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_conv_relationship ON conversations(relationship_id);
CREATE INDEX IF NOT EXISTS idx_msg_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_shared_decks_relationship ON shared_decks(relationship_id);
