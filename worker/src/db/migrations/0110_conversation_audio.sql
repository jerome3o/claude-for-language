-- Conversation audio preferences (docs/AUDIO.md "Conversation audio"): the
-- speed, delivery and voices this account's conversation exercises are spoken
-- in, as JSON per shared/lesson/conversationAudio.ts. NULL = the defaults.
ALTER TABLE users ADD COLUMN conversation_audio TEXT;
