-- The voice a person's chat messages are read aloud in (shared/chats/voice.ts):
-- 'male' | 'female' | 'other', NULL = not set (the app's usual voice).
ALTER TABLE users ADD COLUMN voice_gender TEXT;
