-- Add console_logs field to feature_requests for bug report debugging
ALTER TABLE feature_requests ADD COLUMN console_logs TEXT;
