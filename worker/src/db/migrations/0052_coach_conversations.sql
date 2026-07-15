-- Sentence Coach conversations: persistent chat threads started from a sentence.
-- The first assistant message stores the structured analysis (coach/explain for
-- Chinese input, translation for English input); follow-ups are markdown text.

CREATE TABLE coach_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  input_language TEXT NOT NULL DEFAULT 'zh', -- 'zh' | 'en'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_coach_conversations_user
  ON coach_conversations(user_id, updated_at DESC);

CREATE TABLE coach_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL, -- 'user' | 'assistant'
  -- 'text' for plain markdown; 'analysis' for the structured JSON payload
  content_type TEXT NOT NULL DEFAULT 'text',
  content TEXT NOT NULL,
  -- JSON array of executed tool results (created cards etc.), null if none
  tool_results TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES coach_conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_coach_messages_conversation
  ON coach_messages(conversation_id, created_at);
