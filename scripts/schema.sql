-- Genesis — schema (SQLite)
--
-- Genesis is a record of intent and evidence, not a system of record for the
-- institutions it hands off to. It stores the business's own data, the state of
-- each step, and an append-only event log. It deliberately stores no full SSN
-- (only the last four) and no credentials — those live in Cerulean Vault.

PRAGMA foreign_keys = ON;

-- A client is the tenant: the person or firm using Genesis.
CREATE TABLE IF NOT EXISTS clients (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  email               TEXT NOT NULL UNIQUE,
  -- Authentik subject id — identity belongs to Cerulean's Authentik, never here.
  authentik_subject   TEXT,
  created_at          TEXT NOT NULL
);

-- The business being launched.
CREATE TABLE IF NOT EXISTS businesses (
  id                     TEXT PRIMARY KEY,
  client_id              TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  legal_name             TEXT NOT NULL,
  dba                    TEXT,
  entity_type            TEXT NOT NULL,
  formation_state        TEXT NOT NULL,
  formation_date         TEXT,
  industry               TEXT,
  website_domain         TEXT,
  phone_area_code        TEXT,
  ein                    TEXT,
  duns                   TEXT,
  -- The EIN filing: the third-party designee, the responsible party's signature
  -- and the fax that carried it. One JSON blob; see EinFiling in src/lib/types.ts.
  ein_filing_json        TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_businesses_client ON businesses(client_id);

-- Addresses are first-class: the principal/mailing/agent distinction is what the
-- policy layer validates, so it is not folded into a JSON blob.
CREATE TABLE IF NOT EXISTS addresses (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('principal','mailing','registered_agent')),
  source       TEXT NOT NULL CHECK (source IN ('owned','home','registered_agent','virtual_office')),
  line1        TEXT NOT NULL,
  line2        TEXT,
  city         TEXT NOT NULL,
  state        TEXT NOT NULL,
  postal       TEXT NOT NULL,
  country      TEXT NOT NULL DEFAULT 'US'
);
CREATE INDEX IF NOT EXISTS idx_addresses_business ON addresses(business_id);

-- Responsible parties and officers. ssn_last4 only — never the full number.
CREATE TABLE IF NOT EXISTS people (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ordinal      INTEGER NOT NULL DEFAULT 0,
  role         TEXT NOT NULL,
  full_name    TEXT NOT NULL,
  email        TEXT NOT NULL,
  phone        TEXT,
  ssn_last4    TEXT
);
CREATE INDEX IF NOT EXISTS idx_people_business ON people(business_id);

-- Business tradelines, for the credit readiness model. Only lines held in the
-- entity's own name build the business file, so that is recorded explicitly.
CREATE TABLE IF NOT EXISTS tradelines (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  lender          TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('net30','revolving','installment','card')),
  limit_cents     INTEGER,
  balance_cents   INTEGER,
  opened_at       TEXT,
  -- Comma-separated bureau keys the vendor reports to: dnb, experian, equifax.
  reports_to      TEXT NOT NULL DEFAULT '',
  in_business_name INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_tradelines_business ON tradelines(business_id);

-- Current state of each step, one row per (business, step).
CREATE TABLE IF NOT EXISTS step_states (
  business_id   TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  step_key      TEXT NOT NULL,
  status        TEXT NOT NULL,
  detail        TEXT,
  evidence_json TEXT,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (business_id, step_key)
);

-- Append-only log of everything that happened to a step.
CREATE TABLE IF NOT EXISTS step_events (
  id            TEXT PRIMARY KEY,
  business_id   TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  step_key      TEXT NOT NULL,
  at            TEXT NOT NULL,
  actor         TEXT NOT NULL,
  kind          TEXT NOT NULL,
  detail        TEXT,
  evidence_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_business ON step_events(business_id, at);
