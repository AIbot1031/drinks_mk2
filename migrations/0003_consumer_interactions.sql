-- No backfill: previous preferences do not reveal when interactions happened.
CREATE TABLE IF NOT EXISTS consumer_interactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES consumer_users(id) ON DELETE CASCADE,
  drink_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('like','unlike','dislike','undislike')),
  occurred_at INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  catalog_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS consumer_interactions_user_time
  ON consumer_interactions(user_id, occurred_at, id);
