-- Add maximum_interval column to decks table
-- Maximum review interval in days, default 36500 (~100 years)
ALTER TABLE decks ADD COLUMN maximum_interval INTEGER DEFAULT 36500;
