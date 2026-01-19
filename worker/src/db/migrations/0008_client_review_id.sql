-- Add client_review_id column for deduplication of offline synced reviews
-- This prevents duplicate reviews when the sync request is retried

ALTER TABLE card_reviews ADD COLUMN client_review_id TEXT;

-- Create a unique index on client_review_id (but allow NULL for old reviews)
CREATE UNIQUE INDEX IF NOT EXISTS idx_card_reviews_client_review_id
ON card_reviews(client_review_id) WHERE client_review_id IS NOT NULL;
