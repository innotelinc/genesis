import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { dataDir, databasePath } from "../src/lib/paths";
import {
  dataDir as filingDataDir,
  filingsDir,
  signedSs4Path,
} from "../src/lib/documents/filing-store";
// Deliberately imported here even though it is the one module in this suite that
// opens a real database: where that database lands is the thing being tested.
import db from "../src/lib/db";

/**
 * One data directory, not two.
 *
 * `GENESIS_DATA_DIR` is how a deployment says where its data lives. The document
 * store honored it and the database did not — the database always opened
 * `process.cwd()/data`. On the shipped compose the two coincide (cwd `/app`,
 * volume `/app/data`), so nothing looked wrong; anywhere else the deployment
 * would put the signed filings on the mounted volume and the SQLite record
 * somewhere nothing backs up, silently, and the discovery would be a lost record
 * rather than a failed test.
 *
 * This file asserts the rule and the fact separately, because they can fail
 * independently: what `dataDir` answers, and where the database and the filings
 * actually land once opened and written.
 */

// Set before anything is opened. The database handle is created lazily on first
// use (`db.ts`), so the environment is read at that moment, not at import.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-data-dir-"));
process.env.GENESIS_DATA_DIR = dir;

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the data directory is the configured one", async (t) => {
  await t.test("a configured value wins, trimmed", () => {
    assert.equal(dataDir({ GENESIS_DATA_DIR: "/mnt/genesis" }), "/mnt/genesis");
    assert.equal(dataDir({ GENESIS_DATA_DIR: "  /mnt/genesis  " }), "/mnt/genesis");
  });

  await t.test("unset or blank means the default, not a relative surprise", () => {
    // A compose file that passes an empty variable must fall back rather than
    // resolve to the process's cwd or, worse, to the filesystem root.
    assert.equal(dataDir({}), path.join(process.cwd(), "data"));
    assert.equal(dataDir({ GENESIS_DATA_DIR: "" }), path.join(process.cwd(), "data"));
    assert.equal(dataDir({ GENESIS_DATA_DIR: "   " }), path.join(process.cwd(), "data"));
  });

  await t.test("the database path is derived from it, not from the cwd", () => {
    assert.equal(databasePath({ GENESIS_DATA_DIR: "/mnt/genesis" }), "/mnt/genesis/genesis.db");
    assert.equal(databasePath({}), path.join(process.cwd(), "data", "genesis.db"));
  });

  await t.test("the running deployment is the one under test", () => {
    assert.equal(dataDir(), dir);
  });
});

test("the database lands in that directory, and works there", async (t) => {
  await t.test("the configured directory is where the file is opened", () => {
    assert.equal(db.name, path.join(dir, "genesis.db"));
  });

  await t.test("the schema was applied", () => {
    // A query, not a stat: this proves the file opened *and* that the schema
    // shipped with the code was applied to the one in the deployment's
    // directory — the pair that used to be able to disagree.
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((row) => row.name);
    assert.ok(names.includes("businesses"), `expected a businesses table, got ${names.join(", ")}`);
    assert.ok(names.includes("clients"), `expected a clients table, got ${names.join(", ")}`);
  });

  await t.test("and it is really on disk there", async () => {
    const entries = await fsp.readdir(dir);
    assert.ok(entries.includes("genesis.db"), `expected genesis.db in ${dir}`);
  });
});

test("the documents are in the same tree as the record", async (t) => {
  await t.test("the filing store answers with the same directory", () => {
    // The re-export is deliberate: one answer, asked in two places.
    assert.equal(filingDataDir(), dataDir());
    assert.equal(filingsDir(), path.join(dir, "filings"));
    assert.equal(signedSs4Path("biz_1"), path.join(dir, "filings", "biz_1", "ss4-signed.pdf"));
  });

  await t.test("a filing written beside the database stays beside it", async () => {
    // The property the deployment actually depends on: one backup of one
    // directory takes the record and the evidence together.
    const target = signedSs4Path("biz_1");
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, new Uint8Array([37, 80, 68, 70]));

    const beside = await fsp.readdir(dir);
    assert.ok(beside.includes("genesis.db"));
    assert.ok(beside.includes("filings"));
  });
});
