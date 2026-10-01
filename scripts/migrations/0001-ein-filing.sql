-- 0001 — the EIN filing record.
--
-- Fresh databases get `businesses.ein_filing_json` from schema.sql; this adds it
-- to a database created before the third-party-designee path existed. db.ts
-- swallows the "duplicate column" error a second run raises, so this is safe to
-- apply on every boot.
ALTER TABLE businesses ADD COLUMN ein_filing_json TEXT;
