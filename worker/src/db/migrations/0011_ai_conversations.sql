-- AI Conversations Feature
-- Adds support for AI tutor conversations with Claude

-- Add context field to notes for conversation context on flashcards
ALTER TABLE notes ADD COLUMN context TEXT;

-- Add AI conversation fields to conversations table
ALTER TABLE conversations ADD COLUMN scenario TEXT;
ALTER TABLE conversations ADD COLUMN user_role TEXT;
ALTER TABLE conversations ADD COLUMN ai_role TEXT;
ALTER TABLE conversations ADD COLUMN is_ai_conversation INTEGER DEFAULT 0;
ALTER TABLE conversations ADD COLUMN voice_id TEXT DEFAULT 'female-yujie';
ALTER TABLE conversations ADD COLUMN voice_speed REAL DEFAULT 0.5;

-- Add check status and recording to messages
ALTER TABLE messages ADD COLUMN check_status TEXT CHECK (check_status IN ('correct', 'needs_improvement') OR check_status IS NULL);
ALTER TABLE messages ADD COLUMN check_feedback TEXT;
ALTER TABLE messages ADD COLUMN recording_url TEXT;

-- Create Claude AI system user
INSERT OR IGNORE INTO users (id, email, name, created_at)
VALUES ('claude-ai', 'claude@system.local', 'Claude AI', datetime('now'));
