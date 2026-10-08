CREATE TABLE IF NOT EXISTS consumer_users (
  id TEXT PRIMARY KEY COLLATE BINARY,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  preferences TEXT NOT NULL DEFAULT '{"likedIds":[],"dislikedIds":[]}'
);
CREATE TABLE IF NOT EXISTS consumer_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES consumer_users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS consumer_sessions_expiry ON consumer_sessions(expires_at);
CREATE TABLE IF NOT EXISTS consumer_auth_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
