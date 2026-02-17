-- Add 'reviewed' as a valid homework status (no schema change needed for TEXT column,
-- but we track the status transition: completed -> reviewed)
-- This migration is a no-op since status is a TEXT column, but documents the new status.
SELECT 1;
