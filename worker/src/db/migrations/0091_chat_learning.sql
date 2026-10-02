-- Learning tools in the chat (docs/CHAT.md, PR 3).
-- words: JSON { "source": "content" | "transcript", "words": ReaderWord[] } (shared/reader/words.ts) —
--   the message's text (or a voice message's transcript) split into word chips, concatenating to that
--   text exactly; never served once the text changed. A bare ReaderWord[] is read as source "content".
-- correction: JSON { text, note, by, at } — the tutor's corrected version of the student's message.
ALTER TABLE messages ADD COLUMN words TEXT;
ALTER TABLE messages ADD COLUMN correction TEXT;
