-- 001 — tradelines and the D-U-N-S number.
--
-- schema.sql already carries both for a fresh database; this migration brings an
-- existing database up to it. db.ts applies schema.sql first and then every
-- migration, ignoring the errors of statements that are already satisfied, so
-- the ADD COLUMN here fails harmlessly on a database created from the new
-- schema.sql.

ALTER TABLE businesses ADD COLUMN duns TEXT;

CREATE TABLE IF NOT EXISTS tradelines (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  lender          TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('net30','revolving','installment','card')),
  limit_cents     INTEGER,
  balance_cents   INTEGER,
  opened_at       TEXT,
  reports_to      TEXT NOT NULL DEFAULT '',
  in_business_name INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_tradelines_business ON tradelines(business_id);
