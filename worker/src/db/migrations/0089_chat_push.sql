-- Instant chat: native push tokens, read markers, idempotent sends (docs/CHAT.md §1).

-- One row per installed native app (FCM registration token).
CREATE TABLE device_push_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,          -- FCM registration token
  platform TEXT NOT NULL DEFAULT 'android',
  app TEXT NOT NULL DEFAULT 'lab',     -- 'lab' (future: other native shells)
  device_label TEXT,                   -- e.g. "Pixel 10 Pro Fold" (shown nowhere critical)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_success_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_device_push_tokens_user ON device_push_tokens(user_id);

-- How far each person has read each conversation (read receipts, unread counts,
-- clearing notifications on every device).
CREATE TABLE conversation_reads (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TEXT NOT NULL,          -- created_at of the newest message read (ISO, same format as messages.created_at)
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (conversation_id, user_id)
);

-- Idempotent sends (offline outbox, notification inline reply, retries).
ALTER TABLE messages ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX idx_messages_sender_client ON messages(sender_id, client_id) WHERE client_id IS NOT NULL;

-- Starting markers for existing chats, so history from before read markers is
-- not reported as hundreds of unread messages: a participant with no unread
-- in-app chat notification for the conversation has read all of it; one with an
-- unread notification has read up to their own last message (when they wrote any).
INSERT OR IGNORE INTO conversation_reads (conversation_id, user_id, last_read_at)
SELECT conversation_id, user_id, last_read_at FROM (
  SELECT p.conversation_id, p.user_id,
         CASE WHEN EXISTS (
                SELECT 1 FROM notifications n
                WHERE n.user_id = p.user_id AND n.conversation_id = p.conversation_id AND n.is_read = 0
              )
              THEN (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = p.conversation_id AND m.sender_id = p.user_id)
              ELSE (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = p.conversation_id)
         END AS last_read_at
  FROM (
    SELECT c.id AS conversation_id, r.requester_id AS user_id
      FROM conversations c JOIN tutor_relationships r ON r.id = c.relationship_id
    UNION
    SELECT c.id AS conversation_id, r.recipient_id AS user_id
      FROM conversations c JOIN tutor_relationships r ON r.id = c.relationship_id
  ) p
  JOIN users u ON u.id = p.user_id
)
WHERE last_read_at IS NOT NULL;
