import { test } from "node:test";
import assert from "node:assert/strict";

import { executeStep } from "../src/lib/providers";
import { zeusProvider } from "../src/lib/providers/zeus";
import { ceruleanProvider } from "../src/lib/providers/cerulean";
import { oasisProvider } from "../src/lib/providers/oasis";
import { makeBusiness } from "./fixtures";
import type { StepContext } from "../src/lib/providers/types";

type Call = { url: string; body: unknown };

/** A fetch double that records calls and answers from a queue of responses. */
function fakeFetch(responses: { ok?: boolean; status?: number; json?: unknown }[]) {
  const calls: Call[] = [];
  let index = 0;

  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const next = responses[Math.min(index, responses.length - 1)] ?? {};
    index += 1;
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      json: async () => next.json ?? {},
    } as Response;
  }) as unknown as typeof fetch;

  return { impl, calls };
}

function context(overrides: Partial<StepContext> = {}): StepContext {
  return {
    business: makeBusiness(),
    stepKey: "test",
    provider: "zeus",
    env: {},
    ...overrides,
  };
}

// ── Zeus ──────────────────────────────────────────────────────────────────────

test("Zeus searches for a number, then orders the one it found", async () => {
  const { impl, calls } = fakeFetch([
    { json: [{ did: "14155550100", areacode: "415" }] },
    { json: { ok: true } },
  ]);

  const result = await zeusProvider.run(
    context({
      provider: "zeus",
      env: { ZEUS_API_URL: "https://app.zeus.innotel.us", ZEUS_API_TOKEN: "tok" },
      fetchImpl: impl,
    }),
  );

  assert.equal(result.status, "complete");
  assert.deepEqual(result.evidence?.did, "14155550100");
  assert.equal(calls.length, 2);
  assert.deepEqual((calls[0].body as { action: string }).action, "search");
  assert.deepEqual((calls[1].body as { action: string }).action, "order");
});

test("Zeus reads the live search shape: { status, dids: [...] }", async () => {
  // Captured from the live route (2026-10-01): the list is under `dids`, not
  // `numbers` and not a bare array. The provider used to miss it and report
  // "found no available numbers" while Zeus was answering 200 with candidates.
  const { impl, calls } = fakeFetch([
    {
      json: {
        status: "success",
        dids: [{ did: "4132642700", areacode: "413", server: "pbx-1" }],
      },
    },
    { json: { status: "success" } },
  ]);

  const result = await zeusProvider.run(
    context({
      env: { ZEUS_API_URL: "https://app.zeus.innotel.us", ZEUS_API_TOKEN: "tok" },
      fetchImpl: impl,
    }),
  );

  assert.equal(result.status, "complete");
  assert.equal(result.evidence?.did, "4132642700");
  assert.equal(calls.length, 2);
  assert.equal((calls[1].body as { did: string }).did, "4132642700");
});

test("Zeus still accepts the documented { numbers: [...] } shape", async () => {
  const { impl } = fakeFetch([
    { json: { numbers: [{ did: "14155550100", areacode: "415" }] } },
    { json: { ok: true } },
  ]);

  const result = await zeusProvider.run(
    context({
      env: { ZEUS_API_URL: "https://app.zeus.innotel.us", ZEUS_API_TOKEN: "tok" },
      fetchImpl: impl,
    }),
  );

  assert.equal(result.status, "complete");
  assert.equal(result.evidence?.did, "14155550100");
});

test("Zeus reports a rejected token instead of pretending it worked", async () => {
  const { impl } = fakeFetch([{ ok: false, status: 401, json: {} }]);

  const result = await zeusProvider.run(
    context({
      env: { ZEUS_API_URL: "https://app.zeus.innotel.us", ZEUS_API_TOKEN: "bad" },
      fetchImpl: impl,
    }),
  );

  assert.equal(result.status, "failed");
  assert.match(result.detail, /token/i);
});

// ── Cerulean ──────────────────────────────────────────────────────────────────

test("Cerulean registers the zone, issues TLS and publishes the edge host", async () => {
  // The real bridge: zone, certificates, then the NPM host — each on its own
  // route. A call to `/api/service/hosts` would 404 (it does not exist).
  const { impl, calls } = fakeFetch([
    { status: 201, json: { id: 1 } }, // POST /api/service/domains
    { json: [] }, //                     GET  /api/service/certificates
    { status: 202, json: { id: 7 } }, // POST /api/service/certificates
    { status: 201, json: { npmCertificateId: 42 } }, // POST /api/service/npm/export-cert
    { json: [] }, //                     GET  /api/service/npm/hosts
    { status: 201, json: { id: 3 } }, // POST /api/service/npm/hosts
  ]);

  const result = await ceruleanProvider.run(
    context({
      provider: "cerulean",
      env: {
        CERULEAN_DNS_API_URL: "http://127.0.0.1:3003",
        CERULEAN_SERVICE_KEY: "ceru_x",
        NPM_FORWARD_HOST: "192.168.1.57",
        NPM_FORWARD_PORT: "3002",
      },
      fetchImpl: impl,
    }),
  );

  assert.equal(result.status, "complete");
  assert.deepEqual(result.evidence?.domain, "acme-robotics.com");
  assert.equal(calls.length, 6);

  assert.match(calls[0].url, /\/api\/service\/domains$/);
  assert.equal((calls[0].body as { name: string }).name, "acme-robotics.com");

  assert.match(calls[2].url, /\/api\/service\/certificates$/);
  assert.equal((calls[2].body as { wildcard: boolean }).wildcard, true);

  const host = calls[5].body as {
    domain: string;
    forward_host: string;
    forward_port: number;
    certificate_id: number;
  };
  assert.match(calls[5].url, /\/api\/service\/npm\/hosts$/);
  assert.equal(host.domain, "acme-robotics.com");
  assert.equal(host.forward_port, 3002);
  assert.equal(host.certificate_id, 42);
});

test("Cerulean hands the edge host to a person when no upstream is set", async () => {
  const { impl, calls } = fakeFetch([
    { status: 201, json: { id: 1 } },
    { json: [] },
    { status: 202, json: { id: 7 } },
  ]);

  const result = await ceruleanProvider.run(
    context({
      provider: "cerulean",
      env: { CERULEAN_DNS_API_URL: "http://127.0.0.1:3003", CERULEAN_SERVICE_KEY: "ceru_x" },
      fetchImpl: impl,
    }),
  );

  // Zone + TLS are done; the host is not guessed at.
  assert.equal(result.status, "awaiting_human");
  assert.equal(calls.length, 3);
  assert.ok(result.checklist && result.checklist.length > 0);
});

test("Cerulean refuses to invent a domain", async () => {
  const result = await ceruleanProvider.run(
    context({ provider: "cerulean", business: makeBusiness({ websiteDomain: undefined }) }),
  );
  assert.equal(result.status, "failed");
});

// ── Oasis ─────────────────────────────────────────────────────────────────────

test("Oasis derives the business email from the domain", async () => {
  const result = await oasisProvider.run(context({ provider: "oasis", env: {} }));

  // Without a provisioning endpoint the request is queued, not faked.
  assert.equal(result.status, "awaiting_human");
  assert.deepEqual(result.evidence?.mailbox, "acmeroboticsllc@acme-robotics.com");
});

// ── the guardrail ─────────────────────────────────────────────────────────────

test("a human-attested step never touches the network", async () => {
  let called = false;
  const explodingFetch = (async () => {
    called = true;
    throw new Error("a human-attested step must not reach the network");
  }) as unknown as typeof fetch;

  const env = { ZEUS_API_URL: "x", ZEUS_API_TOKEN: "y" };

  for (const stepKey of [
    "principal_address",
    "entity_formation",
    "ein_application",
    "google_business_profile",
    "business_bank_account",
    "dnb_duns",
    "experian_business",
    "equifax_business",
    "directory_listings",
  ]) {
    const execution = await executeStep(makeBusiness(), stepKey, env, explodingFetch);
    assert.notEqual(execution.result.status, "complete", `${stepKey} cannot complete on its own`);
  }

  assert.equal(called, false);
});

test("the EIN step hands over a prefilled SS-4 and the IRS destination", async () => {
  const execution = await executeStep(makeBusiness(), "ein_application", {});
  const result = execution.result;

  assert.equal(result.status, "awaiting_human");
  assert.match(result.actionUrl ?? "", /irs\.gov/);
  assert.ok(result.artifacts?.some((a) => a.name.startsWith("ss4-")));
  assert.ok((result.checklist ?? []).some((line) => /7b/.test(line)));
});

test("an automated step still runs through the executor", async () => {
  const { impl } = fakeFetch([{ json: [{ did: "14155550100" }] }, { json: {} }]);

  const execution = await executeStep(
    makeBusiness(),
    "phone_number",
    { ZEUS_API_URL: "https://app.zeus.innotel.us", ZEUS_API_TOKEN: "tok" },
    impl,
  );

  assert.equal(execution.result.status, "complete");
  assert.equal(execution.provider, "zeus");
});

test("an unknown step is refused", async () => {
  await assert.rejects(() => executeStep(makeBusiness(), "not_a_step", {}), /No such step/);
});
