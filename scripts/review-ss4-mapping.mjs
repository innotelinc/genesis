#!/usr/bin/env node
// Print the SS-4 field mapping, verified against the form on disk.
//
//   npm run forms:review      (compiles the domain core, then runs this)
//
// This is `describe-form.mjs` taken one step further: after the mapping was
// established against the printed lines, this re-reads the fetched PDF, checks
// every alias still sits next to the label it claims, and prints the whole table
// so a person can review it. Exit code is 1 if anything drifted — a new IRS
// revision, or a field the table does not account for.

import fs from "node:fs";
import path from "node:path";

const formFile = path.join(process.cwd(), "vendor", "forms", "fss4.pdf");

if (!fs.existsSync(formFile)) {
  console.error("review-ss4-mapping: no vendor/forms/fss4.pdf — run `npm run forms` first.");
  process.exit(2);
}

let verifySs4Mapping;
let SS4_ALIASES;
let SS4_UNMAPPED;
try {
  ({ verifySs4Mapping } = await import("../.test-build/src/lib/documents/ss4-verify.js"));
  ({ SS4_ALIASES, SS4_UNMAPPED } = await import("../.test-build/src/lib/documents/ss4-fields.js"));
} catch {
  console.error("review-ss4-mapping: run `npm run test` (or `npx tsc -p tsconfig.test.json`) first.");
  process.exit(2);
}

const report = await verifySs4Mapping(fs.readFileSync(formFile));
const byName = new Map(SS4_ALIASES.map((a) => [a.name, a]));

console.log("genesis — SS-4 mapping review");
console.log(`form:     vendor/forms/fss4.pdf (Rev. ${report.revision ?? "unknown"}, ${report.pageCount} pages)`);
console.log(`fields:   ${report.fieldCount}`);
console.log(`mapped:   ${report.checks.length}   writable: ${report.writable.length}   unmapped: ${SS4_UNMAPPED.length}`);
console.log("");

for (const check of report.checks) {
  const alias = byName.get(check.name);
  const mark = check.ok ? "ok  " : "FAIL";
  const write = alias?.key ? `-> ${alias.key}${alias.on ? `=${alias.on}` : ""}` : "(left to the party)";
  console.log(`${mark} ${check.name}`);
  console.log(`     label:   ${JSON.stringify(check.label)} (${alias?.labelAt})`);
  if (check.matched) console.log(`     printed: ${JSON.stringify(check.matched)}`);
  if (check.reason) console.log(`     problem: ${check.reason}`);
  console.log(`     action:  ${write}`);
}

for (const name of report.unmappedAbsent.concat(SS4_UNMAPPED).filter((v, i, a) => a.indexOf(v) === i && !byName.has(v))) {
  console.log(`?    ${name} (listed as unmapped)`);
}

console.log("");
if (report.unaccounted.length) {
  console.error(`FAIL: ${report.unaccounted.length} field(s) on the form are unaccounted for:`);
  for (const name of report.unaccounted) console.error(`  - ${name}`);
}
if (report.missingFields.length) {
  console.error(`FAIL: ${report.missingFields.length} aliased field(s) are not on the form.`);
}
console.log(report.ok ? "mapping: verified against the fetched form" : "mapping: PROBLEMS (see above)");
process.exit(report.ok ? 0 : 1);
