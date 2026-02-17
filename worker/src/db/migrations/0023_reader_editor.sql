-- Add is_published flag for draft support (default 1 so existing readers remain visible)
ALTER TABLE graded_readers ADD COLUMN is_published INTEGER DEFAULT 1;

-- Add creator_role to track who created the reader
ALTER TABLE graded_readers ADD COLUMN creator_role TEXT DEFAULT 'student';
