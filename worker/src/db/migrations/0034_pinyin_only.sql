-- Flag notes where the learner only knows the pinyin (not the characters)
-- When set, meaning_to_hanzi cards auto-show multiple choice
ALTER TABLE notes ADD COLUMN pinyin_only INTEGER DEFAULT 0;
