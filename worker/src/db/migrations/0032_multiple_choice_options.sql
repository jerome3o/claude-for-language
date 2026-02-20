-- Add multiple choice options column to notes table
-- Stores JSON array of per-character options for meaning_to_hanzi cards
-- Example: [{"correct":"国","options":["围","国","固","圈","因"]},{"correct":"家","options":["家","象","察","豪","嫁"]}]
ALTER TABLE notes ADD COLUMN multiple_choice_options TEXT;
