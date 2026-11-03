-- "💬 Ask Claude" on the Sentence Coach (docs/CHAT.md "Ask Claude chat"): a plain chat with Claude,
-- stored as a coach conversation with action 'ask' (the column has no CHECK, so no change there).
--
-- answer_lang: the language one of Claude's replies is in — 'zh' (plain simple Chinese: word chips,
--   ▶, 🎧 Listen first, 🎤 Read it back) or 'en' (Markdown). Set on the pending row from the turn's
--   language (the 中文 | EN choice, or "in English please"), kept when the reply is written.
-- translation: the English of a Chinese reply (or of my own Chinese message), made on request
--   (EN toggle / Translate) and kept on the row.
ALTER TABLE coach_messages ADD COLUMN answer_lang TEXT;
ALTER TABLE coach_messages ADD COLUMN translation TEXT;

-- kind: what a Claude chat is about — 'ask' (a general chat, no card). NULL = a Sentence Coach
-- conversation (check / explain / translate, in `action`). Generic on purpose: other Claude chats
-- (a card's Ask Claude, role-play, a reader) can join the same table and reply path with a kind.
-- Ask chats also carry action = 'ask' so older apps list them (as an unknown action).
ALTER TABLE coach_conversations ADD COLUMN kind TEXT;
