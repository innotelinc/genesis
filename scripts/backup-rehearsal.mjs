#!/usr/bin/env node
/**
 * A backup of Genesis, and the rehearsal that proves it comes back (v1.0).
 *
 * Genesis's data directory is one directory with two children — `genesis.db` (the record)
 * and `filings/` (the signed Form SS-4s a filing was made from). They are one piece of
 * evidence, which is why `src/lib/paths.ts` answers for both and why this script takes them
 * together: **a backup that captures the record and not the signed copy has captured
 * neither**, because the record says an EIN was filed and the signed copy is what proves it.
 *
 * Three decisions, each of them about a way a backup lies:
 *
 *   1. **The snapshot is taken by SQLite, not by copying the file.** `VACUUM INTO` writes a
 *      consistent copy through the database's own machinery, so a backup taken while the
 *      portal is running cannot capture a torn page or a WAL that has not been folded in —
 *      which is exactly what a backup tool that copies `genesis.db` at 03:00 produces, and
 *      exactly what nobody finds out about until a restore.
 *   2. **The rehearsal restores into a scratch directory.** It never touches the live
 *      deployment: it takes a fresh backup, unpacks it somewhere else, and asks the restored
 *      copy the questions that matter. A rehearsal that writes to the volume it is testing is
 *      not a rehearsal.
 *   3. **It asserts, it does not print.** Every question below is a check with a non-zero
 *      exit on failure — the row counts match the source, the schema arrived, every filing
 *      the record claims is on disk and still reads as a PDF. A restore rehearsal that only
 *      logs "restored OK" is the same as no rehearsal, because nobody reads the log of a
 *      thing that has always worked.
 *
 * Usage:
 *
 *   node scripts/backup-rehearsal.mjs backup [dest]
 *   node scripts/backup-rehearsal.mjs rehearse [dest]
 *   node scripts/backup-rehearsal.mjs list [dest]
 *
 * `dest` defaults to `$GENESIS_BACKUP_DIR`, then `<GENESIS_DATA_DIR>/../backups`.
 * Nodes with no `better-sqlite3` (a bare clone) are refused with the fix, rather than
 * half-failing on a require.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";

const require = createRequire(import.meta.url);

function fail(message) {
  console.error(`backup-rehearsal: ${message}`);
  process.exit(1);
}

let Database;
try {
  Database = require("better-sqlite3");
} catch {
  fail(
    "better-sqlite3 is not installed here. Run this where the app's dependencies are " +
      "(`npm ci`), or inside the running container: `docker exec genesis node scripts/backup-rehearsal.mjs ...`.",
  );
}

/* -------------------------------------------------------------------------- */
/*  Where things are                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The data directory, resolved the way the app resolves it.
 *
 * Duplicated from `src/lib/paths.ts` rather than imported, deliberately: this script has to
 * run against a *backup* on a host that may have no build, and a script that cannot start
 * until the app is built is a script that is not there when it is needed. The rule is three
 * lines and the test for it is `tests/data-dir.test.ts`, which is where a change to it will
 * be caught.
 */
function dataDir() {
  const configured = process.env.GENESIS_DATA_DIR?.trim();
  return configured || path.join(process.cwd(), "data");
}

function backupRoot(argument) {
  const explicit = argument ?? process.env.GENESIS_BACKUP_DIR;
  if (explicit && explicit.trim() !== "") return path.resolve(explicit.trim());
  return path.join(path.dirname(dataDir()), "backups");
}

function stamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-").replace("Z", "Z");
}

const DB_NAME = "genesis.db";
const FILINGS = "filings";
const SS4_NAME = "ss4-signed.pdf";

/* -------------------------------------------------------------------------- */
/*  Taking one                                                                */
/* -------------------------------------------------------------------------- */

function backup(argument) {
  const source = dataDir();
  const database = path.join(source, DB_NAME);
  if (!fs.existsSync(database)) fail(`no database at ${database} — is GENESIS_DATA_DIR right?`);

  const root = backupRoot(argument);
  const target = path.join(root, stamp());
  fs.mkdirSync(target, { recursive: true });

  // The consistent copy. `VACUUM INTO` refuses to overwrite, which is the behaviour we want:
  // a second backup in the same second is a collision to look at, not to clobber.
  const db = new Database(database, { readonly: true });
  try {
    db.exec(`VACUUM INTO '${path.join(target, DB_NAME).replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }

  // The signed copies, taken with the record. A missing `filings/` is not an error — a
  // deployment that has never filed anything has none — but a manifest records which
  // businesses claim a filing, so the rehearsal knows what it is looking for.
  const sourceFilings = path.join(source, FILINGS);
  if (fs.existsSync(sourceFilings)) {
    fs.cpSync(sourceFilings, path.join(target, FILINGS), { recursive: true });
  }

  const counts = countRecord(path.join(target, DB_NAME));
  const manifest = {
    takenAt: new Date().toISOString(),
    source,
    database: DB_NAME,
    counts,
    filings: listFilings(path.join(target, FILINGS)).length,
  };
  fs.writeFileSync(path.join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`backup: ${target}`);
  console.log(
    `        ${counts.businesses} businesses, ${counts.clients} clients, ${counts.events} events, ` +
      `${manifest.filings} signed filing(s)`,
  );
  return target;
}

/* -------------------------------------------------------------------------- */
/*  Asking a restored copy what it knows                                      */
/* -------------------------------------------------------------------------- */

function countRecord(databasePath) {
  const db = new Database(databasePath, { readonly: true });
  try {
    const table = (name) =>
      db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)?.n ?? 0;
    if (table("businesses") === 0 || table("clients") === 0) {
      fail(`${databasePath} has no businesses/clients table — the schema did not arrive`);
    }
    const count = (name) =>
      db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(name).n > 0
        ? db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n
        : 0;
    return {
      businesses: count("businesses"),
      clients: count("clients"),
      events: count("step_events"),
      tradeLines: count("tradelines"),
    };
  } finally {
    db.close();
  }
}

/** Every business the record says has a filing, and whether its signed copy is there. */
function filingExpectations(databasePath) {
  const db = new Database(databasePath, { readonly: true });
  try {
    const rows = db
      .prepare(
        "SELECT id, ein_filing_json FROM businesses WHERE ein_filing_json IS NOT NULL AND ein_filing_json != ''",
      )
      .all();
    const out = [];
    for (const row of rows) {
      let signedDocumentId = null;
      try {
        const parsed = JSON.parse(row.ein_filing_json);
        signedDocumentId = parsed?.signedDocumentId ?? null;
      } catch {
        // A filing record we cannot parse is exactly what a rehearsal is for: report it
        // rather than skipping the business, because "we could not read the filing" is the
        // finding.
        out.push({ businessId: row.id, signedDocumentId: null, unreadable: true });
        continue;
      }
      out.push({ businessId: row.id, signedDocumentId, unreadable: false });
    }
    return out;
  } finally {
    db.close();
  }
}

function listFilings(filingsDir) {
  if (!fs.existsSync(filingsDir)) return [];
  const out = [];
  for (const businessId of fs.readdirSync(filingsDir)) {
    const file = path.join(filingsDir, businessId, SS4_NAME);
    if (fs.existsSync(file)) out.push({ businessId, file });
  }
  return out;
}

/**
 * The questions, each one an assertion.
 *
 * The counts are compared against the *source*, not against a remembered number: a snapshot
 * that silently dropped rows is the failure this is here to catch, and only the source can
 * say how many there should be.
 */
function verify(directory, expected) {
  const database = path.join(directory, DB_NAME);
  if (!fs.existsSync(database)) fail(`${directory} has no ${DB_NAME}`);

  const counts = countRecord(database);
  for (const key of ["businesses", "clients", "events"]) {
    if (expected && counts[key] !== expected[key]) {
      fail(
        `restored copy has ${counts[key]} ${key} where the source had ${expected[key]} — the snapshot is incomplete`,
      );
    }
  }

  const filingsDir = path.join(directory, FILINGS);
  const onDisk = new Set(listFilings(filingsDir).map((entry) => entry.businessId));

  for (const expectation of filingExpectations(database)) {
    if (expectation.unreadable) {
      fail(`business ${expectation.businessId} has a filing record that cannot be parsed`);
    }
    if (expectation.signedDocumentId === null) continue;
    if (!onDisk.has(expectation.businessId)) {
      fail(
        `business ${expectation.businessId} records a signed filing (${expectation.signedDocumentId}) ` +
          `but has no ${FILINGS}/${expectation.businessId}/${SS4_NAME} in the backup`,
      );
    }
    const bytes = fs.readFileSync(path.join(filingsDir, expectation.businessId, SS4_NAME));
    if (bytes.subarray(0, 4).toString("utf8") !== "%PDF") {
      fail(`the signed copy for ${expectation.businessId} is not a PDF any more`);
    }
  }

  console.log(
    `verify: ${directory} — ${counts.businesses} businesses, ${counts.clients} clients, ` +
      `${counts.events} events, ${onDisk.size} signed filing(s) readable`,
  );
  return counts;
}

/* -------------------------------------------------------------------------- */
/*  The rehearsal                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Backup, restore into a scratch directory, and ask it the questions.
 *
 * The scratch copy is the *whole* rehearsal: a backup is a belief about a restore, and the
 * only way to test a belief is to restore it somewhere that is not the thing being backed up.
 */
function rehearse(argument) {
  const source = dataDir();
  const sourceCounts = countRecord(path.join(source, DB_NAME));

  const taken = backup(argument);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-restore-"));
  try {
    fs.cpSync(taken, scratch, { recursive: true });
    const restored = verify(scratch, sourceCounts);
    console.log(
      `rehearsal: OK — the snapshot of ${source} restores into ${scratch} with the schema, ` +
        `the record and the signed copies intact (${restored.businesses} businesses)`,
    );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function list(argument) {
  const root = backupRoot(argument);
  if (!fs.existsSync(root)) {
    console.log(`no backups under ${root}`);
    return;
  }
  const entries = fs
    .readdirSync(root)
    .filter((name) => fs.existsSync(path.join(root, name, DB_NAME)))
    .sort();
  if (entries.length === 0) {
    console.log(`no backups under ${root}`);
    return;
  }
  for (const name of entries) {
    const manifestPath = path.join(root, name, "manifest.json");
    let summary = "";
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        summary = ` — ${manifest.counts.businesses} businesses, ${manifest.filings} filing(s)`;
      } catch {
        summary = " — manifest unreadable";
      }
    }
    console.log(`${name}${summary}`);
  }
  console.log(`\n${entries.length} snapshot(s) under ${root}. The oldest is ${entries[0]}.`);
}

/* -------------------------------------------------------------------------- */

const [command, argument] = process.argv.slice(2);
switch (command) {
  case "backup":
    backup(argument);
    break;
  case "verify":
    // Verifying a directory that is not a snapshot's is how somebody checks a restore they
    // made by hand.
    if (!argument) fail("verify needs a directory");
    verify(argument, null);
    break;
  case "rehearse":
    rehearse(argument);
    break;
  case "list":
    list(argument);
    break;
  default:
    console.log(
      [
        "Usage:",
        "  node scripts/backup-rehearsal.mjs backup [dest]     take a consistent snapshot",
        "  node scripts/backup-rehearsal.mjs rehearse [dest]   snapshot, restore into scratch, verify",
        "  node scripts/backup-rehearsal.mjs verify <dir>      verify a directory as a restored copy",
        "  node scripts/backup-rehearsal.mjs list [dest]       what is there, newest first",
        "",
        "dest defaults to $GENESIS_BACKUP_DIR, then <GENESIS_DATA_DIR>/../backups.",
        "The rehearsal never writes to the live data directory.",
      ].join("\n"),
    );
    process.exit(command === undefined ? 0 : 1);
}
