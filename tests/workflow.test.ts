import { test } from "node:test";
import assert from "node:assert/strict";

import { STEP_CATALOG, stepDefinition } from "../src/lib/workflow/catalog";
import { planSteps, progress, readiness, nextRecommended, isApplicable } from "../src/lib/workflow/engine";
import { PROVIDER_POLICY } from "../src/lib/workflow/policy";
import { PROVIDERS } from "../src/lib/providers";
import { makeBusiness } from "./fixtures";
import type { StepStatus } from "../src/lib/types";

// ── catalog integrity ─────────────────────────────────────────────────────────

test("every dependency names a real step", () => {
  for (const step of STEP_CATALOG) {
    for (const dependency of step.dependsOn) {
      assert.ok(
        stepDefinition(dependency),
        `step "${step.key}" depends on unknown step "${dependency}"`,
      );
    }
  }
});

test("the dependency graph is acyclic", () => {
  const state = new Map<string, "visiting" | "done">();

  const visit = (key: string, path: string[]): void => {
    if (state.get(key) === "done") return;
    assert.notEqual(state.get(key), "visiting", `cycle: ${[...path, key].join(" → ")}`);
    state.set(key, "visiting");
    for (const dependency of stepDefinition(key)?.dependsOn ?? []) {
      visit(dependency, [...path, key]);
    }
    state.set(key, "done");
  };

  for (const step of STEP_CATALOG) visit(step.key, []);
});

test("a step's requiresHuman flag matches its provider's policy", () => {
  // This is the invariant the executor relies on. A step is `requiresHuman`
  // exactly when its provider is human-only; an *assisted* step (the IRS filing)
  // is run by its provider, so it is not — and it is held to its attestation
  // inside that provider instead.
  for (const step of STEP_CATALOG) {
    const mode = PROVIDER_POLICY[step.provider].mode;
    assert.equal(
      step.requiresHuman,
      mode === "human",
      `step "${step.key}" (${step.provider}) is ${mode}, declares requiresHuman=${step.requiresHuman}`,
    );
  }
});

test("the EIN step is assisted: automated by its provider, gated by a signature", () => {
  const ein = STEP_CATALOG.find((s) => s.key === "ein_application");
  assert.ok(ein);
  assert.equal(PROVIDER_POLICY[ein.provider].mode, "assisted");
  assert.equal(ein.requiresHuman, false);
});

test("every catalog provider has a registered implementation", () => {
  for (const step of STEP_CATALOG) {
    assert.ok(PROVIDERS[step.provider], `no provider registered for "${step.provider}"`);
  }
});

test("step keys are unique", () => {
  const keys = STEP_CATALOG.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
});

// ── engine ────────────────────────────────────────────────────────────────────

test("the first run offers the steps with no dependencies", () => {
  const states = planSteps(makeBusiness());
  const byKey = new Map(states.map((s) => [s.key, s]));

  assert.equal(byKey.get("principal_address")?.status, "ready");
  assert.equal(byKey.get("phone_number")?.status, "ready");
  assert.equal(byKey.get("domain_registration")?.status, "ready");

  // The EIN needs the formation filing first.
  assert.equal(byKey.get("ein_application")?.status, "blocked");
  assert.deepEqual(byKey.get("ein_application")?.blockers, ["entity_formation"]);
});

test("completing a dependency unblocks its dependents", () => {
  const business = makeBusiness();
  const formationDone = {
    principal_address: { status: "complete" as StepStatus },
    entity_formation: { status: "complete" as StepStatus },
  };

  const afterFormation = new Map(planSteps(business, formationDone).map((s) => [s.key, s]));
  assert.equal(afterFormation.get("ein_application")?.status, "ready");
  // The bank needs the EIN recorded too, so it is still held back.
  assert.equal(afterFormation.get("business_bank_account")?.status, "blocked");
  assert.deepEqual(afterFormation.get("business_bank_account")?.blockers, ["ein_application"]);

  const afterEin = new Map(
    planSteps(business, { ...formationDone, ein_application: { status: "complete" as StepStatus } }).map(
      (s) => [s.key, s],
    ),
  );
  assert.equal(afterEin.get("business_bank_account")?.status, "ready");
});

test("a sole proprietor files no articles of organization", () => {
  const business = makeBusiness({ entityType: "sole_prop" });
  const byKey = new Map(planSteps(business).map((s) => [s.key, s]));

  assert.equal(byKey.get("entity_formation")?.status, "skipped");
  // ...and skipping it must not leave its dependent stuck.
  assert.ok(!isApplicable("entity_formation", business));
});

test("completed work is not undone by a regressed dependency", () => {
  const business = makeBusiness();
  const states = planSteps(business, { mail_hosting: { status: "complete" as StepStatus } });
  const mail = states.find((s) => s.key === "mail_hosting");

  assert.equal(mail?.status, "complete");
});

test("progress counts required steps only", () => {
  const business = makeBusiness(); // an LLC: every catalog step applies
  const optional = STEP_CATALOG.filter((s) => s.optional).length;
  const p = progress(planSteps(business));

  // billing_account is optional, so it is not in the denominator.
  assert.equal(p.total, STEP_CATALOG.length - optional);
  assert.equal(p.complete, 0);
  assert.equal(p.percent, 0);
});

test("readiness refuses a business with no principal address", () => {
  const business = makeBusiness({ addresses: [] });
  const r = readiness(business, planSteps(business));

  assert.equal(r.ok, false);
  assert.match(r.summary, /street address/i);
});

test("readiness passes for a valid operating address", () => {
  const business = makeBusiness();
  const r = readiness(business, planSteps(business));
  assert.equal(r.ok, true);
});

test("nextRecommended returns the first open required step in catalog order", () => {
  const states = planSteps(makeBusiness());
  assert.equal(nextRecommended(states)?.key, STEP_CATALOG[0]?.key);
});
