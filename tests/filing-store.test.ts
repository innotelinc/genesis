import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  dataDir,
  filingsDir,
  loadSignedSs4,
  saveSignedSs4,
  signedSs4Path,
} from "../src/lib/documents/filing-store";
import { signedSs4Filename } from "../src/lib/documents/filing";
import { makeBusiness } from "./fixtures";

async function withTempDataDir(run: (env: Record<string, string>) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-filing-"));
  try {
    await run({ GENESIS_DATA_DIR: dir });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("the data directory is the configured one, or data/ by default", () => {
  assert.equal(dataDir({ GENESIS_DATA_DIR: "/tmp/x" }), "/tmp/x");
  assert.equal(dataDir({ GENESIS_DATA_DIR: "  " }), path.join(process.cwd(), "data"));
});

test("the signed copy lives under filings/<business>/ on the data volume", () => {
  const env = { GENESIS_DATA_DIR: "/tmp/genesis-data" };
  assert.equal(filingsDir(env), path.join("/tmp/genesis-data", "filings"));
  assert.equal(
    signedSs4Path("biz_1", env),
    path.join("/tmp/genesis-data", "filings", "biz_1", "ss4-signed.pdf"),
  );
});

test("a saved signed SS-4 round-trips", async () => {
  await withTempDataDir(async (env) => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
    const written = await saveSignedSs4("biz_1", bytes, env);

    assert.equal(written, signedSs4Path("biz_1", env));

    const loaded = await loadSignedSs4(makeBusiness(), env);
    assert.ok(loaded, "the copy should load back");
    assert.deepEqual(Array.from(loaded.bytes), Array.from(bytes));
    assert.equal(loaded.filename, signedSs4Filename(makeBusiness()));
  });
});

test("a missing signed copy is a normal state, not an error", async () => {
  await withTempDataDir(async (env) => {
    assert.equal(await loadSignedSs4(makeBusiness(), env), undefined);
  });
});

test("saving creates the business directory it needs", async () => {
  await withTempDataDir(async (env) => {
    await saveSignedSs4("biz_new", new Uint8Array([1]), env);
    const entries = await fs.readdir(path.join(env.GENESIS_DATA_DIR, "filings"));
    assert.deepEqual(entries, ["biz_new"]);
  });
});

test("two businesses never share a signed copy", async () => {
  await withTempDataDir(async (env) => {
    await saveSignedSs4("biz_a", new Uint8Array([1, 1]), env);
    await saveSignedSs4("biz_b", new Uint8Array([2, 2]), env);

    const a = await loadSignedSs4(makeBusiness({ id: "biz_a" }), env);
    const b = await loadSignedSs4(makeBusiness({ id: "biz_b" }), env);

    assert.deepEqual(Array.from(a?.bytes ?? []), [1, 1]);
    assert.deepEqual(Array.from(b?.bytes ?? []), [2, 2]);
  });
});
