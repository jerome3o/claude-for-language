-- Add alternatives column to notes table
-- Stores JSON array of alternative acceptable hanzi answers (e.g. ["另一种写法", "别的写法"])
ALTER TABLE notes ADD COLUMN alternatives TEXT;
