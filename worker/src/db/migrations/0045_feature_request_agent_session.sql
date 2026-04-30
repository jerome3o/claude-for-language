-- Track which agent session is working on a feature request
ALTER TABLE feature_requests ADD COLUMN agent_session_url TEXT;
