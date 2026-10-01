#!/usr/bin/env node
// Verify the sibling-platform integrations, read-only.
//
//   node scripts/check-integrations.mjs
//   npm run check-integrations
//
// This makes NO changes anywhere: it asks each configured platform for its
// health endpoint and reports what came back. It never orders a number,
// registers a domain, creates a mailbox or opens a subscription — those are the
// steps a person triggers from the board, deliberately.
//
// Exit code is 0 when every *configured* integration answers, 1 otherwise, so it
// can be a preflight before a real launch.
//
// The target list is **not** defined here. It lives in
// `src/lib/integrations.json`, where the app's `/api/health/reachability` route
// reads it too — one place a contract can drift, rather than two. The rationale
// for the three uneven targets (Magnate's missing health route, Oasis's
// provisioning endpoint, Signara's health outside its API prefix) is in
// `src/lib/integrations.ts`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TIMEOUT_MS = 8000;

/** Minimal .env reader — no dependency, and shell env always wins. */
function loadEnv() {
  const file = path.join(process.cwd(), ".env");
  const env = { ...process.env };
  if (!fs.existsSync(file)) return env;

  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) env[key] = value;
  }
  return env;
}

/** The shared target list. */
const here = path.dirname(fileURLToPath(import.meta.url));
const TARGETS = JSON.parse(
  fs.readFileSync(path.join(here, "..", "src", "lib", "integrations.json"), "utf8"),
).targets;

async function probe(base, health) {
  // A leading "/" would make `new URL` drop a base path like `/api/v1`, so join
  // the halves by hand.
  const url = `${base.replace(/\/+$/, "")}${health}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // HEAD first so the probe cannot trigger work on an endpoint that treats an
    // unexpected GET as a command.
    let res = await fetch(url, { method: "HEAD", signal: controller.signal, redirect: "manual" });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: "GET", signal: controller.signal, redirect: "manual" });
    }
    return { ok: res.status < 400, status: res.status };
  } catch (error) {
    return { ok: false, status: null, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

const env = loadEnv();
let problems = 0;

console.log("genesis — integration preflight (read-only, changes nothing)");
console.log("");

for (const target of TARGETS) {
  const base = env[target.base] ?? target.defaultBase;
  const hasAuth = Boolean(env[target.auth]);
  const optional = target.optional === true;

  if (!base) {
    const note = optional ? "not configured (optional)" : "NOT CONFIGURED";
    console.log(`  ${target.key.padEnd(9)} ${note}`);
    console.log(`  ${" ".repeat(9)} ${target.purpose}`);
    if (!optional) problems += 1;
    console.log("");
    continue;
  }

  if (!hasAuth) {
    console.log(`  ${target.key.padEnd(9)} configured, but ${target.auth} is empty`);
    if (!optional) problems += 1;
    console.log("");
    continue;
  }

  if (!target.health) {
    console.log(`  ${target.key.padEnd(9)} configured (not probed — it is a provisioning endpoint)`);
    console.log(`  ${" ".repeat(9)} ${target.purpose}`);
    console.log("");
    continue;
  }

  // A target whose health route sits outside the API base's path (Signara) is
  // probed at the origin, not under `/api/v1`.
  let probeBase = base;
  if (target.healthOnOrigin) {
    try {
      probeBase = new URL(base).origin;
    } catch {
      probeBase = base;
    }
  }

  const result = await probe(probeBase, target.health);
  if (result.ok) {
    console.log(`  ${target.key.padEnd(9)} reachable (HTTP ${result.status})`);
  } else if (result.status === 404) {
    // Reachable, but not the contract Genesis speaks.
    console.log(`  ${target.key.padEnd(9)} reachable, but no ${target.health} (HTTP 404)`);
    if (target.healthOnOrigin) {
      console.log(`  ${" ".repeat(9)} probed at ${probeBase} (health is outside the API prefix)`);
    }
    console.log(`  ${" ".repeat(9)} confirm the endpoint in docs/Integrations.md before a real launch`);
    problems += 1;
  } else {
    console.log(`  ${target.key.padEnd(9)} UNREACHABLE ${result.status ?? result.error}`);
    problems += 1;
  }
  console.log(`  ${" ".repeat(9)} ${target.purpose}`);
  console.log("");
}

console.log(problems === 0 ? "integrations: ok" : `integrations: ${problems} problem(s)`);
process.exit(problems === 0 ? 0 : 1);
