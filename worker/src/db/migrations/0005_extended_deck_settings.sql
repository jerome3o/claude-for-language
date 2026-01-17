-- Extended deck settings for more SRS configurability
-- All percentage values stored as integers (e.g., 250 = 2.5 = 250%)

-- Relearning steps (minutes, space-separated) - shown when you fail a review card
ALTER TABLE decks ADD COLUMN relearning_steps TEXT DEFAULT '10';

-- Starting ease factor for new cards (stored as percentage, e.g., 250 = 2.5)
ALTER TABLE decks ADD COLUMN starting_ease INTEGER DEFAULT 250;

-- Minimum ease factor - cards can't drop below this (stored as percentage)
ALTER TABLE decks ADD COLUMN minimum_ease INTEGER DEFAULT 130;

-- Maximum ease factor - cards can't exceed this (stored as percentage)
ALTER TABLE decks ADD COLUMN maximum_ease INTEGER DEFAULT 300;

-- Interval modifier - multiplies all intervals (stored as percentage, 100 = 1.0x)
ALTER TABLE decks ADD COLUMN interval_modifier INTEGER DEFAULT 100;

-- Hard interval multiplier (stored as percentage, 120 = 1.2x)
ALTER TABLE decks ADD COLUMN hard_multiplier INTEGER DEFAULT 120;

-- Easy bonus multiplier (stored as percentage, 130 = 1.3x)
ALTER TABLE decks ADD COLUMN easy_bonus INTEGER DEFAULT 130;
