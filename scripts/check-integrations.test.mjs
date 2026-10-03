import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import test from "node:test";
import { main, probe, TARGETS } from "./check-integrations.mjs";

async function withEndpoint(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

/** Run main() with its report suppressed — the test asserts the exit code, not the log. */
async function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try { return await fn(); }
  finally { console.log = log; }
}

test("HTML with 200 is not a successful API probe, but can be a storefront", async () => {
  await withEndpoint((_req, res) => { res.setHeader("Content-Type", "text/html"); res.end("<html>SPA</html>"); }, async (base) => {
    const api = await probe(base, "/api/health");
    assert.equal(api.ok, false);
    assert.match(api.error, /expected JSON/);
    assert.equal((await probe(base, "/", { json: false })).ok, true);
  });
});

test("redirect to login is not verified API reachability", async () => {
  await withEndpoint((_req, res) => { res.writeHead(302, { Location: "/login" }); res.end(); }, async (base) => {
    const result = await probe(base, "/health");
    assert.equal(result.ok, false);
    assert.match(result.error, /redirected/);
  });
});

test("HEAD fallback accepts the actual JSON endpoint", async () => {
  const methods = [];
  await withEndpoint((req, res) => {
    methods.push(req.method);
    if (req.method === "HEAD") { res.writeHead(405); res.end(); }
    else { res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end('{"ok":true}'); }
  }, async (base) => {
    assert.equal((await probe(base, "/health")).ok, true);
    assert.deepEqual(methods, ["HEAD", "GET"]);
  });
});

test("Cerulean is probed at an API route, not the SPA fallback", () => {
  // /api/health does not exist on Cerulean: the SPA fallback answers it with
  // HTML 200, which used to read as "reachable" without proving the API.
  const cerulean = TARGETS.find((t) => t.key === "cerulean");
  assert.notEqual(cerulean.health, "/api/health");
  assert.equal(cerulean.health, "/api/auth/config");
});

test("only Magnate is allowed to answer non-JSON", () => {
  const allowed = TARGETS.filter((t) => t.health === "/").map((t) => t.key);
  assert.deepEqual(allowed, ["magnate"]);
});

test("Oasis is not probed because its entry point takes commands", () => {
  const oasis = TARGETS.find((t) => t.key === "oasis");
  assert.equal(oasis.health, null);
  assert.equal(oasis.optional, true);
});

test("main() returns 0 when every configured platform answers", async () => {
  await withEndpoint((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end('{"ok":true}');
  }, async (base) => {
    // Every base points at the one stub, and every token is present, so no
    // target is skipped: this exercises the whole probe path, not just the
    // not-configured branches.
    const env = {
      ZEUS_API_URL: base,
      ZEUS_API_TOKEN: "t",
      CERULEAN_DNS_API_URL: base,
      CERULEAN_SERVICE_KEY: "t",
      MAGNATE_URL: base,
      MAGNATE_API_TOKEN: "t",
      SIGNARA_API_URL: base,
      SIGNARA_API_KEY: "t",
    };
    assert.equal(await quiet(() => main(env)), 0);
  });
});

test("main() returns 1 when a required integration is unconfigured", async () => {
  // Zeus and Cerulean are required; with neither base set the preflight must
  // fail, which is what makes it usable as a launch gate.
  assert.equal(await quiet(() => main({})), 1);
});

test("main() returns 1 when a required platform answers HTML instead of JSON", async () => {
  await withEndpoint((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end("<html>SPA</html>");
  }, async (base) => {
    const env = {
      ZEUS_API_URL: base,
      ZEUS_API_TOKEN: "t",
      CERULEAN_DNS_API_URL: base,
      CERULEAN_SERVICE_KEY: "t",
    };
    assert.equal(await quiet(() => main(env)), 1);
  });
});

test("the startup resolver includes sibling-service credentials", () => {
  const script = readFileSync(new URL("../docker-entrypoint.sh", import.meta.url), "utf8");
  const keys = script.match(/VAULT_KEYS="([^"]+)"/)[1].split(/\s+/);
  for (const key of ["ZEUS_API_TOKEN", "CERULEAN_SERVICE_KEY", "SIGNARA_API_KEY", "MAGNATE_API_TOKEN", "OASIS_PROVISION_TOKEN"]) {
    assert.ok(keys.includes(key), key);
  }
});
