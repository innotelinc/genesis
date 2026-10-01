#!/usr/bin/env node
// Dump an AcroForm PDF's fields with geometry, in reading order.
//
//   node scripts/describe-form.mjs vendor/forms/fss4.pdf [--json]
//
// This is the tool that lets Genesis fill an official form field by field.
// It exists because it must be a *reviewed* act: the IRS SS-4 names its 89
// fields `f1_1`…`f1_46` and `c1_1`…`c1_7` and labels none of them, so a mapping
// cannot be derived from the names, and a value in the wrong box on a filing is
// worse than a blank one. Dump the map, match each field to its printed line
// against the real form, encode that as the alias table in
// `src/lib/documents/ss4-fields.ts`, and verify it — `npm run forms:review`.

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--"));
const asJson = args.includes("--json");

if (!target) {
  console.error("usage: node scripts/describe-form.mjs <form.pdf> [--json]");
  process.exit(2);
}

const file = path.resolve(process.cwd(), target);
if (!fs.existsSync(file)) {
  console.error(`describe-form: no such file: ${file}`);
  process.exit(2);
}

let PDFDocument;
try {
  ({ PDFDocument } = await import("pdf-lib"));
} catch {
  console.error("describe-form: pdf-lib is not installed. Run `npm install` first.");
  process.exit(2);
}

const doc = await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true });

let form;
try {
  form = doc.getForm();
} catch (error) {
  console.error(`describe-form: this PDF has no AcroForm (${error.message}).`);
  process.exit(1);
}

const pages = doc.getPages();
const fields = [];

for (const field of form.getFields()) {
  let page = -1;
  let rect = null;

  try {
    const widget = field.acroField.getWidgets()[0];
    if (widget) {
      const r = widget.getRectangle();
      rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      const ref = widget.P();
      if (ref) page = pages.findIndex((p) => p.ref === ref);
    }
  } catch {
    // A field without a widget is still worth listing.
  }

  fields.push({
    name: field.getName(),
    type: field.constructor.name.replace(/^PDF/, ""),
    page,
    ...(rect ?? {}),
    value: typeof field.getText === "function" ? field.getText() || "" : "",
    options: typeof field.getOptions === "function" ? field.getOptions() : undefined,
  });
}

// Reading order: page, then top-to-bottom, then left-to-right.
fields.sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || (b.y ?? 0) - (a.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));

if (asJson) {
  console.log(
    JSON.stringify(
      {
        file: path.relative(process.cwd(), file),
        pages: pages.map((p) => {
          const size = p.getSize();
          return { width: Math.round(size.width), height: Math.round(size.height) };
        }),
        fieldCount: fields.length,
        fields,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const sizes = pages.map((p) => {
  const s = p.getSize();
  return `${Math.round(s.width)}x${Math.round(s.height)}`;
});

console.log(`${path.relative(process.cwd(), file)}`);
console.log(`pages: ${pages.length} (${sizes.join(", ")})`);
console.log(`fields: ${fields.length}`);
console.log("");
console.log("page     x     y    w   type        name");
for (const f of fields) {
  console.log(
    [
      String(f.page ?? "?").padStart(4),
      String(f.x ?? "-").padStart(5),
      String(f.y ?? "-").padStart(5),
      String(f.w ?? "-").padStart(4),
      String(f.type).padEnd(11),
      f.name,
    ].join(" "),
  );
}

console.log("");
console.log("Before enabling auto-fill: match each field above to its printed line on the");
console.log("real form, encode the mapping as an alias table, and render one filled form");
console.log("for a human to check. Do not guess.");
