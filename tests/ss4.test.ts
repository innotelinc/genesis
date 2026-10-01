import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSs4, renderSs4Text, ss4Missing, napBlock, ss4Filename } from "../src/lib/documents/ss4";
import { makeBusiness } from "./fixtures";

function line(fields: ReturnType<typeof buildSs4>, name: string) {
  const found = fields.find((f) => f.line === name);
  assert.ok(found, `no SS-4 line ${name}`);
  return found;
}

test("the legal name and the mailing address are prefilled", () => {
  const fields = buildSs4(makeBusiness());
  assert.equal(line(fields, "1").value, "Acme Robotics LLC");
  assert.equal(line(fields, "1").state, "filled");
  assert.match(line(fields, "4a").value, /123 Main St/);
});

test("the responsible party's full SSN is never filled in", () => {
  const fields = buildSs4(makeBusiness());
  const ssn = line(fields, "7b");

  assert.equal(ssn.value, "");
  assert.equal(ssn.state, "needs_party");
  assert.equal(line(fields, "7a").value, "Dana Reed");
});

test("the third-party designee block is left to the party", () => {
  const fields = buildSs4(makeBusiness());
  assert.equal(line(fields, "Third-party designee").state, "not_applicable");
});

test("Entity type drives the LLC answers", () => {
  assert.equal(line(buildSs4(makeBusiness()), "8a").value, "Yes");
  assert.equal(line(buildSs4(makeBusiness({ entityType: "c_corp" })), "8a").value, "No");
  assert.equal(line(buildSs4(makeBusiness({ entityType: "c_corp" })), "9a").value, "Corporation");
  assert.equal(line(buildSs4(makeBusiness({ entityType: "s_corp" })), "9a").value, "Corporation");
  assert.equal(line(buildSs4(makeBusiness({ entityType: "sole_prop" })), "9a").value, "Sole proprietor");
  // An LLC's 9a box depends on how it is taxed; Genesis leaves it to the party.
  assert.equal(line(buildSs4(makeBusiness()), "9a").state, "needs_party");
});

test("the December 2025 revision's lines are present", () => {
  const fields = buildSs4(makeBusiness());
  // 4a/4b are the mailing address; 5a/5b are the street address, only when it
  // differs. 7b is the party's TIN; 8a/8b/8c are the LLC questions.
  for (const name of ["1", "2", "3", "4a", "4b", "6", "7a", "7b", "8a", "8b", "8c", "9a", "9b", "10", "11", "12", "13", "15", "16", "17", "18"]) {
    assert.ok(fields.some((f) => f.line === name), `line ${name} is missing`);
  }
  // Line 5a/5b are not applicable when 4a already holds the principal address.
  assert.equal(line(fields, "5a").state, "not_applicable");
  assert.equal(line(fields, "5b").state, "not_applicable");
});

test("missing fields are reported rather than invented", () => {
  const business = makeBusiness({ addresses: [], phoneAreaCode: undefined });
  const missing = ss4Missing(buildSs4(business));

  assert.ok(missing.some((m) => /Line 7b/.test(m)), "7b should be flagged");
  assert.ok(missing.some((m) => /Line 4b/.test(m)), "the street address should be flagged");
});

test("the rendered prefill points at the IRS and carries the NAP block", () => {
  const text = renderSs4Text(makeBusiness());

  assert.match(text, /irs\.gov/);
  assert.match(text, /NOT A SUBMISSION/);
  assert.match(text, /Acme Robotics LLC/);
  assert.match(text, /4155550100|\(415\)/);
});

test("the NAP block is order-address-phone-domain", () => {
  const nap = napBlock(makeBusiness());
  assert.equal(nap[0], "Acme Robotics LLC");
  assert.equal(nap[1], "123 Main St");
  assert.equal(nap[2], "Austin, TX 78701");
});

test("the filename is derived from the legal name", () => {
  assert.equal(ss4Filename(makeBusiness()), "ss4-acme-robotics-llc.txt");
});
