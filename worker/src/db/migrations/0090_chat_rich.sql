-- Rich chat messages (docs/CHAT.md, PR 2): edit / delete / pin, photo and voice attachments.
ALTER TABLE messages ADD COLUMN updated_at TEXT;   -- set on ANY change after creation (edit, delete, reaction, transcript, pin, correction)
ALTER TABLE messages ADD COLUMN edited_at TEXT;
ALTER TABLE messages ADD COLUMN deleted_at TEXT;   -- soft delete: content '' and attachment NULL, the row stays
ALTER TABLE messages ADD COLUMN attachment TEXT;   -- JSON ChatAttachment
ALTER TABLE messages ADD COLUMN pinned_at TEXT;
ALTER TABLE messages ADD COLUMN pinned_by TEXT;
CREATE INDEX idx_messages_conv_updated ON messages(conversation_id, updated_at);
