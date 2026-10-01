import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assessCredit,
  businessTradelines,
  monthsBetween,
  revolvingUtilization,
  type CreditAssessment,
  type CreditProfile,
  type Tradeline,
} from "../src/lib/credit/model";
import { creditProfileFor } from "../src/lib/credit/profile";
import { planSteps } from "../src/lib/workflow/engine";
import { makeBusiness } from "./fixtures";
import type { StepStatus } from "../src/lib/types";

const NOW = new Date("2026-09-29T00:00:00.000Z");

/** Ratios are products of divisions, so compare them with a tolerance. */
function close(actual: number, expected: number, message?: string): void {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    message ?? `expected ${expected}, got ${actual}`,
  );
}

function line(overrides: Partial<Tradeline> = {}): Tradeline {
  return {
    lender: "Uline",
    kind: "net30",
    reportsTo: ["dnb"],
    inBusinessName: true,
    ...overrides,
  };
}

function profile(overrides: Partial<CreditProfile> = {}): CreditProfile {
  return {
    hasBusinessAddress: false,
    hasBusinessPhone: false,
    hasDomainAndEmail: false,
    tradelines: [],
    ...overrides,
  };
}

const STRONG: CreditProfile = {
  ein: "12-3456789",
  duns: "123456789",
  formationDate: "2023-01-01",
  bankAccountOpenedAt: "2024-01-01",
  hasBusinessAddress: true,
  hasBusinessPhone: true,
  hasDomainAndEmail: true,
  tradelines: [
    line({ lender: "Uline", reportsTo: ["dnb", "experian"] }),
    line({ lender: "Quill", reportsTo: ["dnb", "experian", "equifax"] }),
    line({ lender: "Grainger", reportsTo: ["dnb", "experian", "equifax"] }),
    line({ lender: "Home Depot Pro", kind: "revolving", limitCents: 500_000, balanceCents: 100_000, reportsTo: ["dnb", "experian", "equifax"] }),
    line({ lender: "Amex Business", kind: "card", limitCents: 400_000, balanceCents: 80_000, reportsTo: ["dnb", "equifax"] }),
  ],
};

// ── the rubric ────────────────────────────────────────────────────────────────

test("the factor weights sum to 100", () => {
  const total = assessCredit(profile(), NOW).factors.reduce((sum, f) => sum + f.weight, 0);
  assert.equal(total, 100);
});

test("contribution is the weight scaled by the ratio", () => {
  for (const factor of assessCredit(STRONG, NOW).factors) {
    assert.equal(factor.contribution, Math.round(factor.weight * factor.ratio * 10) / 10);
  }
});

test("an empty profile scores nothing and has no tier", () => {
  const result = assessCredit(profile(), NOW);
  assert.equal(result.score, 0);
  assert.equal(result.tier, 0);
  assert.match(result.tierLabel, /no file/i);
  assert.ok(result.gaps.length > 0);
});

test("a fully built profile reaches the top tier", () => {
  const result = assessCredit(STRONG, NOW);
  assert.equal(result.tier, 3);
  assert.equal(result.score, 100);
  assert.equal(result.gaps.length, 0);
});

test("a high score without the structure does not earn a tier", () => {
  // Everything is matched and reporting — but one young line is not a file.
  const result = assessCredit(
    {
      ...STRONG,
      formationDate: "2026-08-01",
      tradelines: [line({ reportsTo: ["dnb", "experian", "equifax"] })],
    },
    NOW,
  );

  assert.ok(result.score >= 30, `expected a real score, got ${result.score}`);
  assert.ok(result.score < 85, `expected a capped tier, got ${result.score}`);
  assert.equal(result.tier, 1);
});

test("personal lines do not build the business file", () => {
  const personal = line({ lender: "Owner's card", inBusinessName: false });
  const result = assessCredit(profile({ tradelines: [personal] }), NOW);

  const tradelines = result.factors.find((f) => f.key === "tradelines");
  assert.equal(businessTradelines(profile({ tradelines: [personal] })).length, 0);
  assert.match(tradelines?.detail ?? "", /No tradelines/);
});

test("bureau coverage counts distinct bureaus", () => {
  const one = assessCredit(profile({ tradelines: [line({ reportsTo: ["dnb"] })] }), NOW);
  const three = assessCredit(
    profile({ tradelines: [line({ reportsTo: ["dnb", "experian", "equifax"] })] }),
    NOW,
  );

  const coverageOf = (a: CreditAssessment) =>
    a.factors.find((f) => f.key === "bureau_coverage")?.ratio ?? 0;

  close(coverageOf(one), 1 / 3);
  close(coverageOf(three), 1);
});

test("revolving utilization is measured, not assumed", () => {
  assert.equal(revolvingUtilization([]), null);

  const tight = assessCredit(
    profile({
      tradelines: [line({ kind: "revolving", limitCents: 100_000, balanceCents: 90_000 })],
    }),
    NOW,
  );
  const comfortable = assessCredit(
    profile({
      tradelines: [line({ kind: "revolving", limitCents: 100_000, balanceCents: 10_000 })],
    }),
    NOW,
  );

  const utilOf = (a: CreditAssessment) => a.factors.find((f) => f.key === "utilization")?.ratio ?? 0;
  close(utilOf(tight), 1 / 7);
  close(utilOf(comfortable), 1);
});

test("having no revolving line is full marks, not a penalty", () => {
  const result = assessCredit(profile({ tradelines: [line({ kind: "net30" })] }), NOW);
  const utilization = result.factors.find((f) => f.key === "utilization");
  assert.equal(utilization?.ratio, 1);
  assert.match(utilization?.detail ?? "", /nothing to over-utilise/);
});

test("file age ramps to full marks at two years", () => {
  const ageOf = (from: string) =>
    assessCredit(profile({ formationDate: from }), NOW).factors.find((f) => f.key === "file_age")
      ?.ratio ?? 0;

  close(ageOf("2026-09-01"), 0);
  close(ageOf("2025-09-01"), 0.5);
  close(ageOf("2023-09-01"), 1);
  close(ageOf("2019-09-01"), 1);
});

test("the assessment is deterministic for a given date", () => {
  assert.deepEqual(assessCredit(STRONG, NOW), assessCredit(STRONG, NOW));
});

test("monthsBetween never returns a negative or a NaN", () => {
  assert.equal(monthsBetween(undefined, NOW), 0);
  assert.equal(monthsBetween("not-a-date", NOW), 0);
  assert.equal(monthsBetween("2030-01-01", NOW), 0);
  assert.equal(monthsBetween("2025-09-29", NOW), 12);
});

// ── projection from the record ────────────────────────────────────────────────

test("a queued mailbox is not an email address", () => {
  const business = makeBusiness();
  const states = planSteps(business, {
    principal_address: { status: "complete" as StepStatus },
    domain_registration: { status: "complete" as StepStatus },
    mail_hosting: { status: "awaiting_human" as StepStatus },
  });

  const projected = creditProfileFor(business, states, []);
  assert.equal(projected.hasDomainAndEmail, false);
});

test("identity facts are read from the completed steps and the record", () => {
  const business = makeBusiness({ ein: "12-3456789", duns: "123456789" });
  const states = planSteps(business, {
    principal_address: { status: "complete" as StepStatus },
    phone_number: { status: "complete" as StepStatus },
    domain_registration: { status: "complete" as StepStatus },
    mail_hosting: { status: "complete" as StepStatus },
  });

  const projected = creditProfileFor(business, states, []);
  assert.equal(projected.ein, "12-3456789");
  assert.equal(projected.duns, "123456789");
  assert.equal(projected.hasBusinessPhone, true);
  assert.equal(projected.hasDomainAndEmail, true);
  assert.equal(projected.hasBusinessAddress, true);
});

test("a virtual office principal address is not a matchable address", () => {
  const business = makeBusiness({
    addresses: [
      {
        kind: "principal",
        source: "virtual_office",
        line1: "500 Suite Ave",
        city: "Austin",
        state: "TX",
        postal: "78701",
        country: "US",
      },
    ],
  });

  assert.equal(creditProfileFor(business, planSteps(business), []).hasBusinessAddress, false);
});
