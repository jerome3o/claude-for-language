-- Add screenshot_url field to feature_requests for bug report screenshots
ALTER TABLE feature_requests ADD COLUMN screenshot_url TEXT;
