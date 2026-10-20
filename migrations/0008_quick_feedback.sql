CREATE TABLE quick_feedback (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('menu','region','recommendation','other')),
 message TEXT NOT NULL,
 context_json TEXT NOT NULL,
 reporter_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','rejected')),
 created_at INTEGER NOT NULL,
 reviewed_at INTEGER
);
CREATE INDEX quick_feedback_pending ON quick_feedback(status,created_at DESC);
CREATE INDEX quick_feedback_reporter ON quick_feedback(reporter_hash,created_at);
