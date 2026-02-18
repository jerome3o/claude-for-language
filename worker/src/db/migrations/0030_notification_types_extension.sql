-- Extend notifications table with additional context columns for tutor review and chat notifications
ALTER TABLE notifications ADD COLUMN note_id TEXT;
ALTER TABLE notifications ADD COLUMN conversation_id TEXT;
ALTER TABLE notifications ADD COLUMN relationship_id TEXT;
