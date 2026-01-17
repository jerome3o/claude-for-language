-- Clean slate: remove all existing data before enabling auth
DELETE FROM card_reviews;
DELETE FROM study_sessions;
DELETE FROM note_questions;
DELETE FROM cards;
DELETE FROM notes;
DELETE FROM decks;
DELETE FROM users WHERE id = 'default';

-- Enhance users table for OAuth
ALTER TABLE users ADD COLUMN google_id TEXT;
ALTER TABLE users ADD COLUMN name TEXT;
ALTER TABLE users ADD COLUMN picture_url TEXT;
ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Web app sessions
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- MCP OAuth clients (for DCR)
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_secret_hash TEXT,
  client_name TEXT,
  redirect_uris TEXT NOT NULL,  -- JSON array
  grant_types TEXT DEFAULT '["authorization_code","refresh_token"]',
  created_at TEXT DEFAULT (datetime('now'))
);

-- MCP OAuth tokens
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  access_token_hash TEXT NOT NULL,
  refresh_token_hash TEXT,
  scope TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- MCP authorization codes
CREATE TABLE IF NOT EXISTS oauth_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT,
  code_challenge_method TEXT DEFAULT 'S256',
  scope TEXT,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Add user_id to decks if not exists (for data isolation)
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we'll handle this in app code
-- The user_id column already exists in decks table per the current schema

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user_id ON oauth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_client_id ON oauth_tokens(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_client_id ON oauth_codes(client_id);
