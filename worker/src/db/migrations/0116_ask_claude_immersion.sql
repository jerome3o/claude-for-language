-- Ask Claude in Chinese (docs/STUDY_SESSION.md "Ask Claude"; shared/study/askClaude.ts).
-- users.ask_claude_language: 'zh' | 'en' — what Ask Claude answers in (NULL = the default, Chinese).
-- note_questions:
--   answer_lang          'zh' (plain text, word chips) | 'en' (Markdown) — NULL = an answer from before (English Markdown)
--   answer_words         JSON ReaderWord[] of the answer (shared/reader/words.ts), made on request, served while they still match
--   answer_translation   the answer in English (Translate in the long-press menu), made on request
--   question_words       JSON ReaderWord[] of the learner's question (when it has Chinese)
--   question_translation the question in English
--   question_check       JSON AutoCheckResult (shared/chats/autoCheck.ts): the background "Check my Chinese" of the question
ALTER TABLE users ADD COLUMN ask_claude_language TEXT;
ALTER TABLE note_questions ADD COLUMN answer_lang TEXT;
ALTER TABLE note_questions ADD COLUMN answer_words TEXT;
ALTER TABLE note_questions ADD COLUMN answer_translation TEXT;
ALTER TABLE note_questions ADD COLUMN question_words TEXT;
ALTER TABLE note_questions ADD COLUMN question_translation TEXT;
ALTER TABLE note_questions ADD COLUMN question_check TEXT;
