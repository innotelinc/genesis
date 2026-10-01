import { test } from "node:test";
import assert from "node:assert/strict";

import { loadBlankForm } from "../src/lib/documents/pdf";
import { verifySs4Mapping } from "../src/lib/documents/ss4-verify";
import { SS4_ALIASES, SS4_UNMAPPED, fillSs4 } from "../src/lib/documents/ss4-fields";
import { makeBusiness } from "./fixtures";

const blank = loadBlankForm();

/** The full AcroForm name of the single alias that carries a given key. */
function aliasName(key: string, on?: string): string {
  const found = SS4_ALIASES.find((a) => a.key === key && (on === undefined || a.on === on));
  assert.ok(found, `no alias for key ${key}${on ? ` on ${on}` : ""}`);
  return found.name;
}

test("the alias table verifies against the form the IRS publishes", async (t) => {
  if (!blank) {
    t.diagnostic("official form not fetched — skipping (run: node scripts/fetch-forms.mjs)");
    return;
  }

  const report = await verifySs4Mapping(blank);

  // A silent pass against a stale form would be worse than no check at all.
  assert.match(
    report.revision ?? "",
    /2025/,
    `the fetched form is revision ${report.revision ?? "(none)"}, but the mapping was written for December 2025`,
  );
  assert.equal(report.fieldCount, 89, "the December 2025 SS-4 carries 89 fields");
  assert.equal(report.unaccounted.length, 0, `unaccounted fields: ${report.unaccounted.join(", ")}`);
  assert.equal(report.missingFields.length, 0, `aliased fields missing from the form: ${report.missingFields.join(", ")}`);
  assert.equal(report.unmappedAbsent.length, 0, `unmapped fields missing from the form: ${report.unmappedAbsent.join(", ")}`);

  const failed = report.checks.filter((c) => !c.ok);
  assert.deepEqual(
    failed.map((c) => `${c.name} <- ${JSON.stringify(c.label)} (${c.reason})`),
    [],
    "every alias must sit next to the label it claims",
  );

  t.diagnostic(
    `verified ${report.checks.length} aliases on SS-4 (Rev. ${report.revision}); ${report.writable.length} fields are writable, ${SS4_UNMAPPED.length} explicitly unmapped`,
  );
});

test("every alias is a distinct field and every writable field has a key", () => {
  const names = SS4_ALIASES.map((a) => a.name);
  assert.equal(new Set(names).size, names.length, "an alias is claimed twice");

  for (const alias of SS4_ALIASES) {
    if (alias.kind === "checkbox") {
      assert.ok(alias.on === undefined || alias.key, `${alias.name} has a check value but no key`);
    } else {
      assert.equal(alias.on, undefined, `${alias.name} is a text field with a check value`);
    }
  }
});

test("Genesis never writes a field the responsible party owns", () => {
  const fill = fillSs4(makeBusiness());
  const byName = new Map(SS4_ALIASES.map((a) => [a.name, a]));
  const written = [...Object.keys(fill.text), ...Object.keys(fill.check)];

  assert.ok(written.length > 0, "nothing was filled");
  for (const name of written) {
    const alias = byName.get(name);
    assert.ok(alias?.key, `${name} was written without a key`);
  }

  // Line 7b — the party's SSN/ITIN/EIN — is the one text field the IRS wants
  // from them and only them.
  const tin = SS4_ALIASES.find((a) => a.label === "SSN, ITIN, or EIN");
  assert.ok(tin, "line 7b is not in the alias table");
  assert.equal(tin.key, undefined, "line 7b must not carry a fill key");
  assert.ok(!written.includes(tin.name), "line 7b must never be prefilled");

  for (const alias of SS4_ALIASES) {
    if (alias.key) continue;
    assert.ok(!written.includes(alias.name), `${alias.name} (${alias.label}) must never be prefilled`);
  }
});

test("the identification lines are prefilled from the record", () => {
  const fill = fillSs4(makeBusiness());

  assert.equal(fill.text[aliasName("name")], "Acme Robotics LLC");
  assert.equal(fill.text[aliasName("mailing_street")], "123 Main St");
  assert.equal(fill.text[aliasName("mailing_city")], "Austin, TX 78701");
  assert.equal(fill.text[aliasName("responsible_party")], "Dana Reed");
  assert.equal(fill.text[aliasName("date_started")], "2026-09-01");
  assert.equal(fill.text[aliasName("closing_month")], "December");
  assert.equal(fill.text[aliasName("principal_activity_description")], "Robotics hardware");
  assert.equal(fill.text[aliasName("state_of_incorporation")], "DE");
});

test("Entity type drives the LLC and 9a answers", () => {
  const llc = fillSs4(makeBusiness());
  assert.equal(llc.check[aliasName("llc", "Yes")], true);
  assert.equal(llc.check[aliasName("llc", "No")], undefined);
  assert.equal(llc.check[aliasName("llc_organized_us", "Yes")], true);
  // An LLC's line 9a box depends on how it is taxed; Genesis will not guess.
  assert.equal(llc.check[aliasName("entity_type", "Corporation")], undefined);

  const cCorp = fillSs4(makeBusiness({ entityType: "c_corp" }));
  assert.equal(cCorp.check[aliasName("llc", "No")], true);
  assert.equal(cCorp.check[aliasName("llc", "Yes")], undefined);
  assert.equal(cCorp.check[aliasName("entity_type", "Corporation")], true);
  assert.equal(cCorp.check[aliasName("llc_organized_us", "Yes")], undefined);

  const sole = fillSs4(makeBusiness({ entityType: "sole_prop" }));
  assert.equal(sole.check[aliasName("entity_type", "Sole proprietor")], true);
});

test("line 5a/5b are filled only when the street differs from the mailing address", () => {
  const same = fillSs4(makeBusiness());
  assert.equal(same.text[aliasName("street")], undefined, "the mailing address is already the principal address");

  const mailing = makeBusiness({
    addresses: [
      { kind: "principal", source: "owned", line1: "9 Ranch Rd", city: "Austin", state: "TX", postal: "78702", country: "US" },
      { kind: "mailing", source: "owned", line1: "PO Box 12", city: "Austin", state: "TX", postal: "78701", country: "US" },
    ],
  });
  const different = fillSs4(mailing);
  assert.equal(different.text[aliasName("mailing_street")], "PO Box 12");
  assert.equal(different.text[aliasName("street")], "9 Ranch Rd");
  assert.equal(different.text[aliasName("street_city")], "Austin, TX 78702");
});

test("a missing responsible party is reported, not fabricated", () => {
  const fill = fillSs4(makeBusiness({ people: [] }));
  assert.equal(fill.text[aliasName("responsible_party")], undefined);
  assert.ok(fill.skipped.some((s) => /Name of responsible party/.test(s)));
});
