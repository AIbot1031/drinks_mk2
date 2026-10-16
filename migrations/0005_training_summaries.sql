CREATE TABLE IF NOT EXISTS training_summaries (
 run_id TEXT PRIMARY KEY,
 model TEXT NOT NULL,
 started_at TEXT NOT NULL,
 payload TEXT NOT NULL,
 synced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS training_summaries_started ON training_summaries(started_at DESC);
