import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INTEGRATION_TARGETS,
  integrationsWithConfig,
  probeBase,
  reachability,
  type FetchLike,
} from "../src/lib/integrations";

/**
 * The sibling-platform reachability probe, and the one list it reads.
 *
 * The target list moved out of `scripts/check-integrations.mjs` so the CLI and
 * `/api/health/reachability` cannot drift apart. That is worth a test of its own,
 * because the failure it prevents is silent: a route and a script disagreeing
 * about what "configured" means, with both reporting a confident answer.
 *
 * The probe itself is exercised with an injected `fetch`, so no socket is opened
 * and no sibling platform is touched — which is also the property under test: the
 * probe is read-only, `HEAD` first, and `redirect: "manual"`.
 */

/** A fetch that records what it was asked and answers from a script. */
function recordingFetch(
  answer: (url: string, method: string) => { status: number } | Error,
): { fetchImpl: FetchLike; calls: Array<{ url: string; method: string; redirect: string }> } {
  const calls: Array<{ url: string; method: string; redirect: string }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, redirect: init.redirect });
    const result = answer(url, init.method);
    if (result instanceof Error) throw result;
    return { status: result.status };
  };
  return { fetchImpl, calls };
}

test("the shipped target list is the five siblings, with the uneven ones marked", () => {
  assert.deepEqual(
    INTEGRATION_TARGETS.map((target) => target.key),
    ["zeus", "cerulean", "magnate", "oasis", "signara"],
  );

  const byKey = new Map(INTEGRATION_TARGETS.map((target) => [target.key, target]));

  // The three exceptions, each deliberate. If one of these quietly changes, the
  // probe stops asking the right question and nothing else would say so.
  assert.equal(byKey.get("magnate")?.health, "/", "Magnate is a storefront with no /api/health");
  assert.equal(byKey.get("oasis")?.health, null, "a provisioning endpoint must not be poked");
  assert.equal(byKey.get("signara")?.healthOnOrigin, true, "Signara's /health sits outside /api/v1");

  // Only the two a business cannot launch without are required.
  assert.deepEqual(
    INTEGRATION_TARGETS.filter((target) => target.optional !== true).map((target) => target.key),
    ["zeus", "cerulean"],
  );
});

test("configuration is read without a network, and a default base is not a missing one", () => {
  const bare = integrationsWithConfig({});
  const byKey = new Map(bare.map((integration) => [integration.key, integration]));

  // Required and unset: the two that make a launch impossible.
  assert.equal(byKey.get("zeus")?.configured, false);
  assert.deepEqual(byKey.get("zeus")?.missing, ["ZEUS_API_URL", "ZEUS_API_TOKEN"]);
  assert.equal(byKey.get("cerulean")?.configured, false);

  // Optional and unset: reported, never a problem.
  assert.equal(byKey.get("magnate")?.optional, true);
  assert.equal(byKey.get("magnate")?.configured, false);

  // Signara ships a default base, so only its key is missing — and its base is
  // already resolved, which is what keeps it probeable in a fresh deployment.
  assert.equal(byKey.get("signara")?.base, "https://api.signara.innotel.us/api/v1");
  assert.deepEqual(byKey.get("signara")?.missing, ["SIGNARA_API_KEY"]);

  // Oasis has no endpoint worth poking whatever is configured.
  assert.equal(byKey.get("oasis")?.probeable, false);

  const configured = integrationsWithConfig({
    ZEUS_API_URL: "https://zeus.example.com",
    ZEUS_API_TOKEN: "token",
  });
  const zeus = configured.find((integration) => integration.key === "zeus");
  assert.equal(zeus?.configured, true);
  assert.deepEqual(zeus?.missing, []);
});

test("a reachable sibling, a wrong contract and a dead one are three different answers", async () => {
  const { fetchImpl, calls } = recordingFetch((url) => {
    if (url.startsWith("https://zeus.example.com")) return { status: 200 };
    if (url.startsWith("https://cerulean.example.com")) return { status: 404 };
    return new Error("connect ECONNREFUSED");
  });

  const report = await reachability(
    {
      ZEUS_API_URL: "https://zeus.example.com",
      ZEUS_API_TOKEN: "token",
      CERULEAN_DNS_API_URL: "https://cerulean.example.com",
      CERULEAN_SERVICE_KEY: "key",
      MAGNATE_URL: "https://magnate.example.com",
      MAGNATE_API_TOKEN: "token",
      OASIS_PROVISION_URL: "https://oasis.example.com",
      OASIS_PROVISION_TOKEN: "token",
    },
    { fetchImpl, now: () => new Date("2026-10-01T00:00:00.000Z") },
  );

  const byKey = new Map(report.integrations.map((integration) => [integration.key, integration]));

  assert.equal(byKey.get("zeus")?.verdict, "reachable");
  assert.equal(byKey.get("zeus")?.status, 200);

  // A 404 from a healthy service is *the contract having moved*, which is a
  // different thing to fix than a service that is down.
  assert.equal(byKey.get("cerulean")?.verdict, "wrong-contract");
  assert.match(String(byKey.get("cerulean")?.detail), /confirm the endpoint/);

  assert.equal(byKey.get("magnate")?.verdict, "unreachable");
  assert.match(String(byKey.get("magnate")?.detail), /ECONNREFUSED/);

  // Oasis is configured but deliberately never asked.
  assert.equal(byKey.get("oasis")?.verdict, "not-probed");
  assert.ok(!calls.some((call) => call.url.startsWith("https://oasis.example.com")));

  // Signara is *half* configured out of the box: it ships a default base, so the
  // only thing missing is its key. Optional, so still not a problem.
  assert.equal(byKey.get("signara")?.verdict, "incomplete");
  assert.match(String(byKey.get("signara")?.detail), /SIGNARA_API_KEY is empty/);

  // Two problems: the sibling whose contract moved, and the optional platform that
  // is deployed but dead — an optional platform that is *down* is still something
  // an operator needs told, while one that is simply not deployed is not.
  assert.equal(report.problems, 2);
  assert.equal(report.ok, false);
  assert.equal(report.checkedAt, "2026-10-01T00:00:00.000Z");
});

test("a required integration that is unset is a problem, an optional one is not", async () => {
  const { fetchImpl } = recordingFetch(() => ({ status: 200 }));
  const report = await reachability({}, { fetchImpl });

  const byKey = new Map(report.integrations.map((integration) => [integration.key, integration]));
  assert.equal(byKey.get("zeus")?.verdict, "not-configured");
  assert.match(String(byKey.get("zeus")?.detail), /NOT CONFIGURED/);
  assert.equal(byKey.get("magnate")?.verdict, "not-configured");
  assert.match(String(byKey.get("magnate")?.detail), /optional/);

  // Zeus and Cerulean are the only two that must be set.
  assert.equal(report.problems, 2);
  assert.equal(report.ok, false);
});

test("a half-configured integration says which variable is empty", async () => {
  const { fetchImpl } = recordingFetch(() => ({ status: 200 }));
  const report = await reachability(
    { ZEUS_API_URL: "https://zeus.example.com" },
    { fetchImpl },
  );

  const zeus = report.integrations.find((integration) => integration.key === "zeus");
  assert.equal(zeus?.verdict, "incomplete");
  assert.match(String(zeus?.detail), /ZEUS_API_TOKEN is empty/);
});

test("Signara is probed at the origin, not under its versioned base", async () => {
  const { fetchImpl, calls } = recordingFetch(() => ({ status: 200 }));
  await reachability(
    { SIGNARA_API_URL: "https://api.signara.innotel.us/api/v1", SIGNARA_API_KEY: "key" },
    { fetchImpl },
  );

  // Asking `/api/v1/health` would 404 against a perfectly healthy API, because
  // Signara's health controller deliberately sits outside that prefix.
  assert.deepEqual(
    calls.map((call) => call.url),
    ["https://api.signara.innotel.us/health"],
  );
});

test("the probe is read-only: HEAD first, no redirects, and GET only when HEAD is refused", async () => {
  // A route that refuses HEAD but serves GET: exactly the case the fallback exists for.
  const { fetchImpl, calls } = recordingFetch((_url, method) => ({ status: method === "HEAD" ? 405 : 200 }));
  const first = await probeBase("https://zeus.example.com", "/api/health", fetchImpl);

  assert.equal(calls[0]?.method, "HEAD", "an unexpected GET must not trigger work");
  assert.equal(calls[0]?.redirect, "manual", "a probe does not follow a redirect it did not name");
  assert.equal(calls[1]?.method, "GET", "405/501 means the route does not take HEAD");
  assert.equal(first.ok, true, "the GET that answered is the verdict");
  assert.equal(first.status, 200);

  const { fetchImpl: refused } = recordingFetch(() => ({ status: 501 }));
  const second = await probeBase("https://zeus.example.com", "/api/health", refused);
  assert.equal(second.ok, false, "501 does not become a success just because GET was tried");
});

test("a base path survives the join, and a trailing slash does not double up", async () => {
  const { fetchImpl, calls } = recordingFetch(() => ({ status: 200 }));
  await probeBase("https://api.example.com/api/v1/", "/documents", fetchImpl);

  // A leading "/" on the health path would make `new URL` drop `/api/v1`.
  assert.deepEqual(
    calls.map((call) => call.url),
    ["https://api.example.com/api/v1/documents"],
  );
});

test("a probe that never answers is a failure, not a hang", async () => {
  const neverAnswers: FetchLike = async (_url, init) => {
    // Never resolves on its own; the probe's own timeout must be what ends it.
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  };

  const result = await probeBase("https://slow.example.com", "/api/health", neverAnswers, 10);
  assert.equal(result.ok, false);
  assert.equal(result.status, null);
  assert.match(String(result.error), /aborted/);
});
