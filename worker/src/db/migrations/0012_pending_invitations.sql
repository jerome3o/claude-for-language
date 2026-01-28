-- Pending invitations for users who haven't signed up yet
CREATE TABLE IF NOT EXISTS pending_invitations (
  id TEXT PRIMARY KEY,
  inviter_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  inviter_role TEXT NOT NULL CHECK (inviter_role IN ('tutor', 'student')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  FOREIGN KEY (inviter_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_pending_inv_email_status ON pending_invitations(recipient_email, status);
CREATE INDEX idx_pending_inv_inviter ON pending_invitations(inviter_id, status);
