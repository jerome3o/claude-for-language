-- Add approval workflow for feature requests
-- Admin-submitted requests are auto-approved; non-admin requests need admin review
ALTER TABLE feature_requests ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending';

-- Auto-approve existing admin-submitted requests
UPDATE feature_requests SET approval_status = 'approved'
WHERE user_id IN (SELECT id FROM users WHERE is_admin = 1);
