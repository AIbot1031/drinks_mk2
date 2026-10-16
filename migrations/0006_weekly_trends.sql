CREATE TABLE IF NOT EXISTS weekly_trends (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS trend_refresh_lock (
  id INTEGER PRIMARY KEY CHECK(id=1),
  locked_until INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO trend_refresh_lock(id,locked_until) VALUES(1,0);
