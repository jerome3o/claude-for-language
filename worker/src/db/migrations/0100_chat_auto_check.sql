-- "Check my Chinese automatically" (docs/CHAT.md "Auto-check"): the background check of a
-- learner's chat message, as JSON (shared/chats/autoCheck.ts AutoCheckResult, with the text it
-- was about — served only while the message still says that), and the per-account switch
-- (NULL = the default: on for the learner side of a chat, 1 = always, 0 = never).
ALTER TABLE messages ADD COLUMN auto_check TEXT;
ALTER TABLE users ADD COLUMN chat_auto_check INTEGER;
