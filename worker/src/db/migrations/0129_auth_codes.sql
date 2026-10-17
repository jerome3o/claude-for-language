-- One-time sign-in codes (services/auth.ts createAuthCode / exchangeAuthCode).
-- The Google callback no longer hands the session token to the app: it stores a
-- 60-second, single-use code here (only its SHA-256), bound to the PKCE challenge
-- the app sent to /api/auth/login, and redirects with ?code=. The app trades
-- code + verifier for the session at POST /api/auth/exchange; the row is deleted
-- by that exchange (or by the daily cron once expired).
CREATE TABLE IF NOT EXISTS auth_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- base64url(SHA-256(verifier)), 43 characters.
  challenge TEXT NOT NULL,
  -- 'web' | 'lab' | 'desktop' (who started the sign-in).
  client TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_codes_expires_at ON auth_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_codes_user_id ON auth_codes(user_id);
