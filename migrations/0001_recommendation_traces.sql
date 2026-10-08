CREATE TABLE IF NOT EXISTS recommendation_traces (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  query TEXT NOT NULL,
  result_count INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS recommendation_traces_created ON recommendation_traces(created_at);
