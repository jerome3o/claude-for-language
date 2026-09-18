-- Invite-only sign-up.
--
-- users.can_invite: who may create invites (admins always can).
-- invites: link/email invites; the id is the bearer token in /join/<id>.
-- invite_redemptions: which user redeemed which invite (idempotent by pair).
-- access_requests: uninvited Google sign-in attempts, for the admin to approve.

ALTER TABLE users ADD COLUMN can_invite INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  email TEXT,
  inviter_role TEXT CHECK (inviter_role IN ('tutor', 'student') OR inviter_role IS NULL),
  share_deck_ids TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1,
  use_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_invites_created_by ON invites(created_by);
CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);

CREATE TABLE IF NOT EXISTS invite_redemptions (
  invite_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  redeemed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (invite_id, user_id),
  FOREIGN KEY (invite_id) REFERENCES invites(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS access_requests (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  picture_url TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  attempts INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);
