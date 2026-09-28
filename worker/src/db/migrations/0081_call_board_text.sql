-- Video calls: the shared text board (shared/calls/textDoc.ts) — its plain text, copied from the
-- CallRoom Durable Object with the drawing board and the chat, for the review page, the lesson
-- report and the session-notes homework agent.
ALTER TABLE calls ADD COLUMN board_text TEXT;
