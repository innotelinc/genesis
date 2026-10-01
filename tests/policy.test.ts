import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertAutomationAllowed,
  assistedProviders,
  canAutomate,
  isHumanOnly,
  looksLikeDomainOrUrl,
  PolicyError,
  policySummary,
  providerMode,
  requiresAttestation,
  validateAddress,
  validatePrincipalAddress,
  PROVIDER_POLICY,
} from "../src/lib/workflow/policy";
import { makeBusiness } from "./fixtures";
import type { Address, ProviderKey } from "../src/lib/types";

const valid: Address = {
  kind: "principal",
  source: "owned",
  line1: "123 Main St",
  city: "Austin",
  state: "TX",
  postal: "78701",
  country: "US",
};

// ── the automation boundary ───────────────────────────────────────────────────

test("only the platforms this stack owns may be automated", () => {
  const automated = policySummary()
    .filter((p) => p.mode === "automated")
    .map((p) => p.provider)
    .sort();

  assert.deepEqual(automated, ["cerulean", "magnate", "oasis", "zeus"]);
});

test("the institutions that require attestation are human-only", () => {
  const humanOnly: ProviderKey[] = [
    "bank",
    "google",
    "dnb",
    "experian",
    "equifax",
    "state",
    "address",
    "listings",
  ];
  for (const provider of humanOnly) {
    assert.equal(isHumanOnly(provider), true, `${provider} must be human-only`);
    assert.equal(canAutomate(provider), false, `${provider} must not be automatable`);
  }
});

// ── the assisted boundary (the IRS, filed as third-party designee) ─────────────

test("the IRS is assisted, not automated and not human-only", () => {
  assert.equal(providerMode("irs"), "assisted");
  assert.equal(requiresAttestation("irs"), true);
  // It is neither of the other two: it may reach the institution, but only from
  // the responsible party's signature.
  assert.equal(canAutomate("irs"), false);
  assert.equal(isHumanOnly("irs"), false);
  assert.deepEqual(assistedProviders(), ["irs"]);
});

test("an assisted provider is refused until the signature is on record", () => {
  assert.throws(
    () => assertAutomationAllowed("irs"),
    (error: unknown) =>
      error instanceof PolicyError && error.code === "attestation_required",
    "irs must not transmit without an attestation",
  );

  assert.doesNotThrow(() =>
    assertAutomationAllowed("irs", { authorizedAt: "2026-09-30T00:00:00.000Z" }),
  );
});

test("an automated provider is still refused when it is human-attested", () => {
  // The assisted mode must not have loosened the human-only guard.
  assert.throws(
    () => assertAutomationAllowed("bank"),
    (error: unknown) =>
      error instanceof PolicyError && error.code === "automation_not_permitted",
  );
});

test("automating a human-only provider throws a PolicyError", () => {
  for (const provider of ["bank", "google", "experian", "equifax", "dnb"] as ProviderKey[]) {
    assert.throws(
      () => assertAutomationAllowed(provider),
      (error: unknown) =>
        error instanceof PolicyError && error.code === "automation_not_permitted",
      `${provider} should have been refused`,
    );
  }
});

test("an automated provider passes the automation check", () => {
  for (const provider of ["zeus", "cerulean", "oasis", "magnate"] as ProviderKey[]) {
    assert.doesNotThrow(() => assertAutomationAllowed(provider));
  }
});

test("every provider carries a human-readable reason", () => {
  for (const [provider, policy] of Object.entries(PROVIDER_POLICY)) {
    assert.ok(policy.reason.length > 20, `${provider} needs a real reason`);
  }
});

// ── address validation ────────────────────────────────────────────────────────

test("a domain, URL or email is not a street address", () => {
  assert.equal(looksLikeDomainOrUrl("acme.com"), true);
  assert.equal(looksLikeDomainOrUrl("https://acme.com/office"), true);
  assert.equal(looksLikeDomainOrUrl("dana@acme.com"), true);
  assert.equal(looksLikeDomainOrUrl("123 Main St"), false);
});

test("a domain in the address field is rejected", () => {
  const problems = validateAddress({ ...valid, line1: "acme.com" });
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /not a street address/i);
});

test("a street line without a number is rejected", () => {
  const problems = validateAddress({ ...valid, line1: "Main Street" });
  assert.match(problems[0].message, /street number/i);
});

test("a malformed postal code is rejected", () => {
  const problems = validateAddress({ ...valid, postal: "7870" });
  assert.equal(problems.some((p) => p.field === "postal"), true);
});

test("a complete address has no problems", () => {
  assert.deepEqual(validateAddress(valid), []);
});

test("a virtual office cannot be the principal place of business", () => {
  const business = makeBusiness({ addresses: [{ ...valid, source: "virtual_office" }] });
  const problems = validatePrincipalAddress(business);

  assert.equal(problems.some((p) => p.field === "source"), true);
});

test("a registered agent address cannot be the principal place of business", () => {
  const business = makeBusiness({ addresses: [{ ...valid, source: "registered_agent" }] });
  assert.equal(validatePrincipalAddress(business).some((p) => p.field === "source"), true);
});

test("a missing principal address is reported, not assumed", () => {
  const business = makeBusiness({ addresses: [{ ...valid, kind: "mailing" }] });
  const problems = validatePrincipalAddress(business);

  assert.equal(problems[0].field, "principal");
});

test("an owned operating address is accepted as principal", () => {
  const business = makeBusiness();
  assert.deepEqual(validatePrincipalAddress(business), []);
});
