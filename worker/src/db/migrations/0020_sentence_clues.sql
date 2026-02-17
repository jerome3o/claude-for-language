-- Migration: Add sentence clue fields to notes table
-- This enables storing example sentences with audio for disambiguating homophones

ALTER TABLE notes ADD COLUMN sentence_clue TEXT;
ALTER TABLE notes ADD COLUMN sentence_clue_audio_url TEXT;
