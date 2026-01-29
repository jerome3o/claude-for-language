-- Migration: FSRS Algorithm Support
-- Adds FSRS-specific columns to cards table and updates deck settings

-- Add FSRS columns to cards table
-- stability: Memory stability (days until R drops to 90%)
-- difficulty: Card difficulty (1-10)
-- lapses: Number of times the card was forgotten (Again count)
ALTER TABLE cards ADD COLUMN stability REAL DEFAULT 0;
ALTER TABLE cards ADD COLUMN difficulty REAL DEFAULT 0;
ALTER TABLE cards ADD COLUMN lapses INTEGER DEFAULT 0;

-- Add FSRS settings to decks table
-- request_retention: Target retention rate (0.7 to 0.97), default 0.9
-- fsrs_weights: JSON array of 21 FSRS weight parameters (null = use defaults)
ALTER TABLE decks ADD COLUMN request_retention REAL DEFAULT 0.9;
ALTER TABLE decks ADD COLUMN fsrs_weights TEXT DEFAULT NULL;

-- Note: The old SM-2 columns (ease_factor, interval, repetitions, learning_step)
-- are kept for backward compatibility and can be used as fallback data.
-- New cards will use FSRS (stability, difficulty, lapses) going forward.

-- Update existing cards to have reasonable FSRS defaults:
-- - stability: derived from interval (stability ≈ interval for 90% retention)
-- - difficulty: derived from ease_factor (lower ease = higher difficulty)
-- - lapses: 0 (we don't have historical lapse data)
UPDATE cards SET
  stability = CASE
    WHEN interval > 0 THEN interval
    ELSE 0
  END,
  difficulty = CASE
    WHEN ease_factor > 0 THEN
      -- Map ease_factor (1.3-3.0) to difficulty (1-10)
      -- ease 3.0 → difficulty 1, ease 1.3 → difficulty 10
      ROUND(1 + (3.0 - ease_factor) * (9.0 / 1.7), 2)
    ELSE 5.0
  END,
  lapses = 0
WHERE stability = 0 OR stability IS NULL;
