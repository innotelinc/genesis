#!/usr/bin/env node
// Seed a demo client and business so a fresh checkout has something to look at.
//
// It writes through the same schema the app uses, and deliberately leaves the
// step_state table empty — a newly seeded business should show the untouched
// board, with the first steps ready and the dependent ones blocked.

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
// The same rule as the app (`src/lib/paths.ts`): `GENESIS_DATA_DIR` names the deployment's
// data directory, and a seed that ignored it would put a demo database somewhere the portal
// never reads — the same split the database itself used to have. Empty counts as unset.
const configured = process.env.GENESIS_DATA_DIR?.trim();
const dataDir = configured && configured !== "" ? configured : path.join(root, "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "genesis.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(fs.readFileSync(path.join(root, "scripts", "schema.sql"), "utf8"));

const now = new Date().toISOString();
const businessId = randomUUID();

// Reuse the demo client when it is already there. `INSERT OR IGNORE` would keep
// the existing row and hand back the id we just generated, so a re-run would
// insert a business pointing at a client that does not exist.
const demoClient = db.prepare("SELECT id FROM clients WHERE authentik_subject = ?").get("dev-local");
const clientId = demoClient?.id ?? randomUUID();
if (!demoClient) {
  db.prepare(
    "INSERT INTO clients (id, name, email, authentik_subject, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(clientId, "Demo client", "demo@genesis.innotel.us", "dev-local", now);
}

db.prepare(
  `INSERT INTO businesses
     (id, client_id, legal_name, dba, entity_type, formation_state, formation_date,
      industry, website_domain, phone_area_code, ein, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
).run(
  businessId,
  clientId,
  "Acme Robotics LLC",
  "Acme Robotics",
  "llc",
  "DE",
  "2026-09-01",
  "Robotics hardware",
  "acme-robotics.com",
  "415",
  now,
  now,
);

db.prepare(
  `INSERT INTO addresses (id, business_id, kind, source, line1, line2, city, state, postal, country)
   VALUES (?, ?, 'principal', 'owned', ?, NULL, ?, ?, ?, 'US')`,
).run(randomUUID(), businessId, "123 Main St", "Austin", "TX", "78701");

db.prepare(
  `INSERT INTO people (id, business_id, ordinal, role, full_name, email, phone, ssn_last4)
   VALUES (?, ?, 0, ?, ?, ?, ?, ?)`,
).run(
  randomUUID(),
  businessId,
  "Manager",
  "Dana Reed",
  "dana@acme-robotics.com",
  "+14155550100",
  "1234",
);

// A demo that deliberately starts with the domain in the address field would be
// a bad first impression — but the policy is worth showing, so mention it.
console.log("genesis seed: created");
console.log(`  client    demo@genesis.innotel.us (subject dev-local)`);
console.log(`  business  Acme Robotics LLC  →  /businesses/${businessId}`);
console.log("");
console.log("  Run with GENESIS_DEV_AUTH=1 npm run dev, then sign in.");
console.log("  The principal address is a real street address; change it to a domain");
console.log("  in the intake form to watch the filing gate refuse the hand-off.");
