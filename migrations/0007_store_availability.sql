CREATE TABLE IF NOT EXISTS drink_stores (
 id TEXT PRIMARY KEY, brand TEXT NOT NULL, name TEXT NOT NULL, address TEXT NOT NULL,
 verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)), source_url TEXT NOT NULL DEFAULT '', checked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS stores_verified_brand ON drink_stores(verified,brand);
CREATE TABLE IF NOT EXISTS store_availability (
 store_id TEXT NOT NULL REFERENCES drink_stores(id), product_key TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('available','sold_out','not_sold')), checked_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 evidence TEXT NOT NULL, source_url TEXT NOT NULL DEFAULT '', PRIMARY KEY(store_id,product_key)
);
CREATE TABLE IF NOT EXISTS store_reports (
 id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES drink_stores(id), product_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('sold_out','not_sold')), created_at INTEGER NOT NULL, reporter_hash TEXT NOT NULL,
 review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','confirmed','rejected'))
);
CREATE INDEX IF NOT EXISTS store_reports_pending ON store_reports(review_status,created_at);
CREATE INDEX IF NOT EXISTS store_reports_rate ON store_reports(reporter_hash,created_at);
CREATE INDEX IF NOT EXISTS store_reports_created ON store_reports(created_at);
