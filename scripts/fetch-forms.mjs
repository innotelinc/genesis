#!/usr/bin/env node
// Fetch the official government forms Genesis attaches to its packets.
//
// The forms are public-domain US government documents and are NOT committed
// (vendor/ is gitignored, the same posture as every other platform in the stack
// that pins upstream build inputs). Idempotent: an existing, valid file is left
// alone unless --force is passed.
//
//   node scripts/fetch-forms.mjs            # fetch anything missing
//   node scripts/fetch-forms.mjs --check    # verify without the network
//   node scripts/fetch-forms.mjs --force    # re-download everything

import fs from "node:fs";
import path from "node:path";

const FORMS = [
  {
    file: "fss4.pdf",
    name: "Form SS-4 (Application for EIN)",
    url: "https://www.irs.gov/pub/irs-pdf/fss4.pdf",
  },
];

const dir = path.join(process.cwd(), "vendor", "forms");
const force = process.argv.includes("--force");
const checkOnly = process.argv.includes("--check");

/** A real PDF starts with %PDF and is not a stub; an error page would not. */
function isValidPdf(file) {
  try {
    const bytes = fs.readFileSync(file);
    if (bytes.length < 4096) return false;
    return bytes.subarray(0, 4).toString("latin1") === "%PDF";
  } catch {
    return false;
  }
}

async function main() {
  if (!checkOnly) fs.mkdirSync(dir, { recursive: true });

  let failures = 0;

  for (const form of FORMS) {
    const target = path.join(dir, form.file);
    const present = isValidPdf(target);

    if (checkOnly) {
      console.log(`${present ? "ok      " : "MISSING "} ${form.file}  ${form.name}`);
      if (!present) failures += 1;
      continue;
    }

    if (present && !force) {
      console.log(`ok       ${form.file}  (already present)`);
      continue;
    }

    try {
      const res = await fetch(form.url, { redirect: "follow" });
      if (!res.ok) {
        console.error(`FAILED   ${form.file}  HTTP ${res.status} from ${form.url}`);
        failures += 1;
        continue;
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length < 4096 || bytes.subarray(0, 4).toString("latin1") !== "%PDF") {
        console.error(`FAILED   ${form.file}  response was not a PDF (${bytes.length} bytes)`);
        failures += 1;
        continue;
      }
      fs.writeFileSync(target, bytes);
      console.log(`fetched  ${form.file}  ${bytes.length} bytes  ${form.name}`);
    } catch (error) {
      console.error(`FAILED   ${form.file}  ${error instanceof Error ? error.message : error}`);
      failures += 1;
    }
  }

  if (checkOnly) {
    console.log(failures === 0 ? "forms: ok" : `forms: ${failures} missing`);
    process.exit(failures === 0 ? 0 : 1);
  }

  if (failures > 0) {
    console.error("");
    console.error("Some forms could not be fetched. Genesis still produces a complete");
    console.error("worksheet for every document; only the attached official form is missing.");
    process.exit(1);
  }

  console.log("");
  console.log("Next: node scripts/describe-form.mjs vendor/forms/fss4.pdf");
  console.log("      prints the official form's field map, which is what a reviewed");
  console.log("      auto-fill mapping would be built from.");
}

await main();
