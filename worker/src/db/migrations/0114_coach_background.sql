-- Sentence Coach replies run in the background (docs/CHAT.md "Chat ↔ Coach"):
-- the POST stores a PENDING assistant message and returns at once; the
-- coach-reply-queue consumer writes the reply into it, so leaving the page (or
-- the isolate ending) never loses it.
--   status: NULL = done (every row before this migration), 'pending', 'failed'
--   error: the readable reason of a failed reply (Retry re-queues it)
--   attempts: deliveries so far; checkpoint: the model's answer + which tool
--   actions already ran, so a redelivery never asks Claude again nor makes a
--   card twice; started_at: when the current attempt began (stale sweep).
ALTER TABLE coach_messages ADD COLUMN status TEXT;
ALTER TABLE coach_messages ADD COLUMN error TEXT;
ALTER TABLE coach_messages ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE coach_messages ADD COLUMN checkpoint TEXT;
ALTER TABLE coach_messages ADD COLUMN started_at TEXT;

CREATE INDEX IF NOT EXISTS idx_coach_messages_pending ON coach_messages(status) WHERE status IS NOT NULL;

-- "Open in Coach" from a chat message: the conversation remembers the message,
-- so opening it again reopens the same conversation.
ALTER TABLE coach_conversations ADD COLUMN source_message_id TEXT;
CREATE INDEX IF NOT EXISTS idx_coach_conversations_source ON coach_conversations(user_id, source_message_id);
