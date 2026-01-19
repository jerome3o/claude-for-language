-- Migration: Event-Sourced Review Architecture
-- This migration adds tables for event-sourced card state computation.
-- Review events become the source of truth; card state is computed from events.

-- Review events table - the source of truth for all reviews
-- Each row represents a single review action at a point in time
CREATE TABLE IF NOT EXISTS review_events (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 0 AND rating <= 3),
  time_spent_ms INTEGER,
  user_answer TEXT,
  recording_url TEXT,
  reviewed_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  -- Snapshot fields for debugging/auditing (NOT used for computation)
  -- These capture the state AFTER this review was applied
  snapshot_queue INTEGER,
  snapshot_ease REAL,
  snapshot_interval INTEGER,
  snapshot_next_review_at TEXT,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Index for fetching events by card (for state computation)
CREATE INDEX IF NOT EXISTS idx_review_events_card ON review_events(card_id, reviewed_at);

-- Index for syncing events by user since timestamp
CREATE INDEX IF NOT EXISTS idx_review_events_sync ON review_events(user_id, created_at);

-- Index for fetching events by user and card (for history queries)
CREATE INDEX IF NOT EXISTS idx_review_events_user_card ON review_events(user_id, card_id);

-- Card checkpoints table - performance optimization for state computation
-- Instead of replaying all events, start from the most recent checkpoint
CREATE TABLE IF NOT EXISTS card_checkpoints (
  card_id TEXT PRIMARY KEY,
  checkpoint_at TEXT NOT NULL,          -- ISO timestamp of last event included
  event_count INTEGER NOT NULL,         -- Total events processed up to checkpoint
  -- Computed state at checkpoint
  queue INTEGER NOT NULL,
  learning_step INTEGER NOT NULL,
  ease_factor REAL NOT NULL,
  interval INTEGER NOT NULL,
  repetitions INTEGER NOT NULL,
  next_review_at TEXT,                  -- ISO timestamp for review cards
  due_timestamp INTEGER,                -- Unix ms for learning/relearning cards
  -- Metadata
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

-- Sync metadata table - tracks last sync state per user
CREATE TABLE IF NOT EXISTS sync_metadata (
  user_id TEXT PRIMARY KEY,
  last_event_at TEXT,                   -- Last event timestamp synced
  last_sync_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
