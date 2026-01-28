-- Add status field to graded_readers for async generation tracking
ALTER TABLE graded_readers ADD COLUMN status TEXT DEFAULT 'ready';

-- Create index for faster status queries
CREATE INDEX IF NOT EXISTS idx_graded_readers_status ON graded_readers(status);
