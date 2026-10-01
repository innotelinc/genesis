import { test } from "node:test";
import assert from "node:assert/strict";

import { irsProvider } from "../src/lib/providers/irs";
import { zeusSendFax } from "../src/lib/providers/zeus";
import { executeStep } from "../src/lib/providers";
import { resolveEinFaxNumber, signedSs4Filename } from "../src/lib/documents/filing";
import { makeBusiness } from "./fixtures";
import type { StepContext } from "../src/lib/providers/types";
import type { Business, EinFiling } from "../src/lib/types";

type Call = { url: string; method?: string; authorization?: string; isForm: boolean };

/** A fetch double that records calls. It must never be reached un-attested. */
function fakeFetch(responses: { ok?: boolean; status?: number; json?: unknown }[] = []) {
  const calls: Call[] = [];
  let index = 0;

  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: String(input),
      method: init?.method,
      authorization: headers.authorization,
      isForm: init?.body instanceof FormData,
    });
    const next = responses[Math.min(index, responses.length - 1)] ?? { ok: true, json: {} };
    index += 1;
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      json: async () => next.json ?? {},
    } as Response;
  }) as unknown as typeof fetch;

  return { impl, calls };
}

const FILING: EinFiling = {
  designeeName: "Innotel Filing Services",
  designeePhone: "+13025550100",
  designeeFax: "+13025550101",
  designeeAddress: "500 Filing Way, Wilmington, DE 19801",
  authorizedAt: "2026-09-30T12:00:00.000Z",
  signedDocumentId: "data/filings/biz_1/ss4-signed.pdf",
  status: "authorized",
};

function business(overrides: Partial<Business> = {}): Business {
  return makeBusiness(overrides);
}

function context(overrides: Partial<StepContext> = {}): StepContext {
  return {
    business: business(),
    stepKey: "ein_application",
    provider: "irs",
    env: {},
    ...overrides,
  };
}

const FAX_ENV = {
  ZEUS_API_URL: "https://app.zeus.innotel.us",
  ZEUS_API_TOKEN: "tok",
  ZEUS_FAX_FROM_DID_ID: "did_123",
  IRS_EIN_FAX_NUMBER: "+18557778888",
};

// ── preparing, before the party has signed ────────────────────────────────────

test("without a signature the IRS step prepares and never touches the network", async () => {
  const { impl, calls } = fakeFetch();

  const result = await irsProvider.run(context({ env: FAX_ENV, fetchImpl: impl }));

  assert.equal(result.status, "awaiting_human");
  assert.equal(calls.length, 0, "nothing may be transmitted before the signature");
  assert.ok(result.artifacts?.some((a) => a.name.startsWith("ss4-")));
  assert.ok((result.checklist ?? []).some((line) => /designee/i.test(line)));
  assert.ok((result.checklist ?? []).some((line) => /sign/i.test(line)));
  assert.match(result.actionUrl ?? "", /irs\.gov/);
});

test("an authorization with no signed copy still stops short of filing", async () => {
  const { impl, calls } = fakeFetch();
  const authorized = business({ einFiling: { ...FILING, signedDocumentId: undefined } });

  const result = await irsProvider.run(
    context({
      business: authorized,
      attestation: { authorizedAt: FILING.authorizedAt },
      env: FAX_ENV,
      fetchImpl: impl,
    }),
  );

  assert.equal(result.status, "awaiting_human");
  assert.equal(calls.length, 0);
  assert.equal(result.evidence?.stage, "awaiting_signed_form");
});

test("an authorized filing with no configured IRS fax line fails loudly", async () => {
  const { impl, calls } = fakeFetch();

  const result = await irsProvider.run(
    context({
      business: business({ einFiling: FILING }),
      attestation: { authorizedAt: FILING.authorizedAt },
      signedDocument: { bytes: new Uint8Array([1, 2, 3]), filename: "ss4-signed.pdf" },
      env: { ...FAX_ENV, IRS_EIN_FAX_NUMBER: "" },
      fetchImpl: impl,
    }),
  );

  assert.equal(result.status, "failed");
  assert.match(result.detail, /IRS_EIN_FAX_NUMBER/);
  assert.equal(calls.length, 0, "a missing number must not send the filing somewhere else");
});

// ── filing, once signed ───────────────────────────────────────────────────────

test("the signed SS-4 is faxed to the IRS EIN line through Zeus", async () => {
  const { impl, calls } = fakeFetch([{ status: 201, json: { fax: { id: "fax_1" }, sent: true } }]);

  const result = await irsProvider.run(
    context({
      business: business({ einFiling: FILING }),
      attestation: { authorizedAt: FILING.authorizedAt, reference: FILING.signedDocumentId },
      signedDocument: { bytes: new Uint8Array([37, 80, 68, 70]), filename: signedSs4Filename(business()) },
      env: FAX_ENV,
      fetchImpl: impl,
    }),
  );

  assert.equal(result.status, "complete");
  assert.equal(result.evidence?.faxId, "fax_1");
  assert.equal(result.evidence?.toFaxNumber, "+18557778888");

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/fax\/send$/);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].isForm, true, "Zeus takes the fax as multipart/form-data");
  assert.equal(calls[0].authorization, "Bearer tok");
});

test("a rejected fax is reported, not swallowed", async () => {
  const { impl } = fakeFetch([{ ok: false, status: 403, json: { error: "forbidden" } }]);

  const result = await irsProvider.run(
    context({
      business: business({ einFiling: FILING }),
      attestation: { authorizedAt: FILING.authorizedAt },
      signedDocument: { bytes: new Uint8Array([1]), filename: "ss4-signed.pdf" },
      env: FAX_ENV,
      fetchImpl: impl,
    }),
  );

  assert.equal(result.status, "failed");
  assert.match(result.detail, /forbidden|token/i);
});

test("a malformed fax response is treated as a failure, not a success", async () => {
  const { impl } = fakeFetch([{ status: 500, json: {} }]);

  const result = await irsProvider.run(
    context({
      business: business({ einFiling: FILING }),
      attestation: { authorizedAt: FILING.authorizedAt },
      signedDocument: { bytes: new Uint8Array([1]), filename: "ss4-signed.pdf" },
      env: FAX_ENV,
      fetchImpl: impl,
    }),
  );

  assert.equal(result.status, "failed");
});

// ── the destination is configuration, resolved per state ──────────────────────

test("the IRS fax line resolves by state before the single default", () => {
  const env = {
    IRS_EIN_FAX_BY_STATE: JSON.stringify({ TX: "+18559990000" }),
    IRS_EIN_FAX_NUMBER: "+18001112222",
  };

  // The fixture's principal address is Austin, TX.
  assert.equal(resolveEinFaxNumber(business(), env), "+18559990000");
  // With no principal address and a state the table does not carry, it falls
  // back to the single line.
  assert.equal(
    resolveEinFaxNumber(business({ addresses: [], formationState: "WY" }), env),
    "+18001112222",
  );
  assert.equal(resolveEinFaxNumber(business(), {}), undefined);
});

test("a malformed per-state table falls back instead of failing the filing", () => {
  const env = { IRS_EIN_FAX_BY_STATE: "{not json", IRS_EIN_FAX_NUMBER: "+18001112222" };
  assert.equal(resolveEinFaxNumber(business(), env), "+18001112222");
});

// ── through the executor (the attestation comes from the record) ───────────────

test("the executor prepares the EIN step when the record carries no signature", async () => {
  const execution = await executeStep(business(), "ein_application", FAX_ENV);
  assert.equal(execution.provider, "irs");
  assert.equal(execution.result.status, "awaiting_human");
});

test("the executor files the EIN once the record is signed and the copy is supplied", async () => {
  const { impl, calls } = fakeFetch([{ status: 201, json: { fax: { id: "fax_9" }, sent: true } }]);

  const execution = await executeStep(
    business({ einFiling: FILING }),
    "ein_application",
    FAX_ENV,
    impl,
    { bytes: new Uint8Array([37, 80, 68, 70]), filename: "ss4-signed.pdf" },
  );

  assert.equal(execution.result.status, "complete");
  assert.equal(execution.result.evidence?.faxId, "fax_9");
  assert.equal(calls.length, 1);
});

// ── the Zeus fax client on its own ────────────────────────────────────────────

test("Zeus fax echoes the API's own refusal message", async () => {
  const { impl } = fakeFetch([{ ok: false, status: 400, json: { error: "Source DID is required" } }]);

  const result = await zeusSendFax(
    context({ env: FAX_ENV, fetchImpl: impl }),
    { toFaxNumber: "+1", fromDidId: "", pdf: new Uint8Array([1]), filename: "x.pdf" },
  );

  assert.equal(result.ok, false);
  assert.match(result.detail, /Source DID is required/);
});
