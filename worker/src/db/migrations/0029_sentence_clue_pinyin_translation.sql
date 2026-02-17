-- Migration: Add pinyin and translation fields to sentence clues
-- This enables showing pinyin and English translation alongside example sentences

ALTER TABLE notes ADD COLUMN sentence_clue_pinyin TEXT;
ALTER TABLE notes ADD COLUMN sentence_clue_translation TEXT;
