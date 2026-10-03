-- Chat e-mails can be turned off (docs/CHAT.md "E-mail opt-out"): 1 = a new chat
-- message also sends an e-mail (the default), 0 = off. Push notifications are
-- separate and unaffected.
ALTER TABLE users ADD COLUMN email_chat_messages INTEGER NOT NULL DEFAULT 1;
