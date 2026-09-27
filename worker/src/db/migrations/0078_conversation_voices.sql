-- Conversation voices (Settings → Conversation voices, routes/conversation-voices.ts):
-- which MiniMax voices this account's conversation exercises are spoken in, as a
-- JSON array of ids from shared/lesson/voices.ts. NULL = not customised: the
-- admin's own selection applies, else the shipped defaults.
ALTER TABLE users ADD COLUMN conversation_voices TEXT;
ALTER TABLE users ADD COLUMN conversation_voices_updated_at TEXT;
