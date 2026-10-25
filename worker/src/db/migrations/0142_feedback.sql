-- In-app feedback (docs/FEEDBACK.md): feedback is a feature_requests row, so the admin page and the
-- MCP feature-request tools see it like any other request.
--   kind           'request' (the old feature-request form) | 'feedback' | 'bug'
--   client_id      the device's id for the item — POST /api/feedback is idempotent by (user, client_id)
--   context        JSON per shared/feedback (platform, app version, route pattern, device, online…)
--   screenshot_key R2 `feedback/<user>/<id>.<ext>` (person-made, private: the author and admins)
ALTER TABLE feature_requests ADD COLUMN kind TEXT NOT NULL DEFAULT 'request';
ALTER TABLE feature_requests ADD COLUMN client_id TEXT;
ALTER TABLE feature_requests ADD COLUMN context TEXT;
ALTER TABLE feature_requests ADD COLUMN screenshot_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_requests_client ON feature_requests(user_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_feature_requests_screenshot_key ON feature_requests(screenshot_key) WHERE screenshot_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_feature_requests_user_created ON feature_requests(user_id, created_at);
