-- The graded-reader queue ("Up next", shared/reader/queue.ts; docs/STUDY_SESSION.md "Graded readers"):
-- the order unread stories are offered in. NULL = never placed by hand — those come first, newest
-- first (the rule before this column, and where a new story lands). A move / reorder writes a priority
-- on every reader of the queue (higher first). Organisation only: read state stays in reader_review_events.
ALTER TABLE graded_readers ADD COLUMN queue_priority INTEGER;
