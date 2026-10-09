-- Photo albums in the chat (docs/CHAT.md "Photo albums"): photos picked together are still one
-- message each, and share a client-chosen album id so the apps draw them as ONE bubble.
--   album_id          the album (NULL = not part of one; photos sent before albums existed)
--   album_index       0-based position in the album as picked
--   album_notified_at when the album's ONE notification (push / e-mail / bell) went out — set on
--                     the photo that claimed it, so the recipient gets "📷 3 photos" once, not three times
ALTER TABLE messages ADD COLUMN album_id TEXT;
ALTER TABLE messages ADD COLUMN album_index INTEGER;
ALTER TABLE messages ADD COLUMN album_notified_at TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_album ON messages(conversation_id, album_id) WHERE album_id IS NOT NULL;
