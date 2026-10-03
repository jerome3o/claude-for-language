-- Forwarded messages (docs/CHAT.md "Round 2 — PR 3"): the source message id; the
-- client shows "↪ Forwarded". Files / video clips need no column (messages.attachment JSON).
ALTER TABLE messages ADD COLUMN forwarded_from TEXT;
