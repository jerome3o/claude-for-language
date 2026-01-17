-- Anki-style scheduler migration
-- Adds queue tracking, learning steps, and deck settings

-- Card queue tracking
-- queue: 0=new, 1=learning, 2=review, 3=relearning
ALTER TABLE cards ADD COLUMN queue INTEGER DEFAULT 0;
ALTER TABLE cards ADD COLUMN learning_step INTEGER DEFAULT 0;
ALTER TABLE cards ADD COLUMN due_timestamp INTEGER;  -- Unix ms for intra-day timing

-- Deck settings for spaced repetition
ALTER TABLE decks ADD COLUMN new_cards_per_day INTEGER DEFAULT 20;
ALTER TABLE decks ADD COLUMN learning_steps TEXT DEFAULT '1 10';  -- minutes, space-separated
ALTER TABLE decks ADD COLUMN graduating_interval INTEGER DEFAULT 1;  -- days
ALTER TABLE decks ADD COLUMN easy_interval INTEGER DEFAULT 4;  -- days

-- Daily new card tracking to enforce limits
CREATE TABLE IF NOT EXISTS daily_counts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  deck_id TEXT,
  date TEXT NOT NULL,
  new_cards_studied INTEGER DEFAULT 0,
  UNIQUE(user_id, deck_id, date)
);

-- Migrate existing cards:
-- Cards with next_review_at = NULL are new (queue=0)
-- Cards with next_review_at set are in review queue (queue=2)
UPDATE cards SET
  queue = CASE WHEN next_review_at IS NULL THEN 0 ELSE 2 END,
  due_timestamp = CASE
    WHEN next_review_at IS NOT NULL
    THEN CAST((julianday(next_review_at) - 2440587.5) * 86400000 AS INTEGER)
    ELSE NULL
  END
WHERE queue IS NULL;

-- Create indexes for efficient queue queries
CREATE INDEX IF NOT EXISTS idx_cards_queue ON cards(queue);
CREATE INDEX IF NOT EXISTS idx_cards_due_timestamp ON cards(due_timestamp);
CREATE INDEX IF NOT EXISTS idx_daily_counts_lookup ON daily_counts(user_id, deck_id, date);
