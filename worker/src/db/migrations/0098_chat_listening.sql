-- Listening mode in the chat (docs/CHAT.md "Listening mode"): per person and
-- conversation, the other person's Chinese text messages created after `since`
-- arrive hidden (tap plays, long press reveals). The server reads it to keep
-- notification previews from spoiling a hidden message.
CREATE TABLE chat_listening (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listening INTEGER NOT NULL DEFAULT 1,
  since TEXT,                              -- ISO; NULL = not decided yet (the client stores its read marker)
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_chat_listening_user ON chat_listening(user_id);

-- Settings → Chat → "Listening mode in new chats": the default for a conversation with no row.
ALTER TABLE users ADD COLUMN chat_listening_default INTEGER NOT NULL DEFAULT 0;

-- The pre-generated read-aloud clip of a message (R2 `chat-tts/<conv>/<msg>-<hash>.mp3`,
-- the hash covers text + voice + speed, so an edit makes a new clip).
ALTER TABLE messages ADD COLUMN audio_key TEXT;
