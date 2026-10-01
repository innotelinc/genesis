import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

import {
  DOCUMENT_KEYS,
  buildWorksheet,
  documentFilename,
  documentPolicyNote,
  type Worksheet,
} from "../src/lib/documents/worksheet";
import { loadBlankForm, renderWorksheet, wrap, blankFormPath } from "../src/lib/documents/pdf";
import { SS4_ALIASES, fillSs4 } from "../src/lib/documents/ss4-fields";
import { assessCredit } from "../src/lib/credit/model";
import { makeBusiness } from "./fixtures";

const business = makeBusiness();
const assessment = assessCredit(
  {
    hasBusinessAddress: true,
    hasBusinessPhone: true,
    hasDomainAndEmail: true,
    tradelines: [],
  },
  new Date("2026-09-29T00:00:00.000Z"),
);

function rows(worksheet: Worksheet) {
  return worksheet.sections.flatMap((s) => s.rows ?? []);
}

// ── worksheet content ─────────────────────────────────────────────────────────

test("every document key produces a titled worksheet with sections", () => {
  for (const key of DOCUMENT_KEYS) {
    const worksheet = buildWorksheet(key, business, assessment);
    assert.ok(worksheet.title.length > 0, `${key} has no title`);
    assert.ok(worksheet.sections.length > 0, `${key} has no sections`);
    assert.ok(worksheet.footer.length > 0, `${key} has no footer disclaimer`);
  }
});

test("each document names the record it was generated from", () => {
  for (const key of DOCUMENT_KEYS) {
    const worksheet = buildWorksheet(key, business, assessment);
    const text = JSON.stringify(worksheet);
    assert.match(text, /Acme Robotics LLC/, `${key} does not name the business`);
  }
});

test("no document claims to have been submitted", () => {
  for (const key of DOCUMENT_KEYS) {
    const text = JSON.stringify(buildWorksheet(key, business, assessment)).toLowerCase();
    assert.doesNotMatch(text, /we (have )?(filed|submitted|applied)/, `${key} overclaims`);
    assert.match(text, /not (a submission|.*advice)|genesis (does not|never)/, `${key} lacks a disclaimer`);
  }
});

test("the SS-4 worksheet leaves the party's fields blank", () => {
  const worksheet = buildWorksheet("ss4", business, assessment);
  const all = rows(worksheet);

  const ssn = all.find((r) => /SSN\/ITIN\/EIN of responsible party/.test(r.label));
  assert.ok(ssn, "the SSN line should exist");
  assert.ok(ssn, "the SSN line is missing");
  assert.equal(ssn.emphasis, "blank");
  assert.equal(ssn.value, "");

  const name = all.find((r) => /Name of entity/.test(r.label));
  assert.equal(name?.value, "Acme Robotics LLC");
});

test("the SS-4 worksheet cites the IRS, not a Genesis submission URL", () => {
  const worksheet = buildWorksheet("ss4", business, assessment);
  assert.ok(worksheet.intro.some((line) => /irs\.gov/.test(line)));
});

test("the bureau dossier folds in the credit assessment", () => {
  const withCredit = buildWorksheet("bureaus", business, assessment);
  const without = buildWorksheet("bureaus", business);

  assert.match(JSON.stringify(withCredit), /Readiness/);
  assert.doesNotMatch(JSON.stringify(without), /Readiness/);
});

test("the bank packet requires the EIN letter", () => {
  const worksheet = buildWorksheet("bank", business, assessment);
  assert.match(JSON.stringify(worksheet), /CP 575/);
});

test("the google dossier refuses a virtual address", () => {
  const worksheet = buildWorksheet("google", business, assessment);
  assert.match(JSON.stringify(worksheet).toLowerCase(), /virtual office|suspend/);
});

test("filenames are derived from the legal name", () => {
  assert.equal(documentFilename("ss4", business), "ss4-acme-robotics-llc.pdf");
});

test("every document key resolves a policy reason", () => {
  for (const key of DOCUMENT_KEYS) {
    assert.ok(documentPolicyNote(key).length > 20, `${key} has no policy note`);
  }
});

// ── rendering ─────────────────────────────────────────────────────────────────

test("wrap respects the measured width", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const words = "the quick brown fox jumps over the lazy dog and keeps running";
  const lines = wrap(words, font, 10, 80);

  assert.ok(lines.length > 1, "expected the text to wrap");
  for (const line of lines) {
    assert.ok(font.widthOfTextAtSize(line, 10) <= 80, `line too wide: ${line}`);
  }
});

test("a worksheet renders to a loadable PDF", async () => {
  const worksheet = buildWorksheet("bank", business, assessment);
  const bytes = await renderWorksheet(worksheet);

  assert.equal(Buffer.from(bytes.subarray(0, 4)).toString("latin1"), "%PDF");

  const reloaded = await PDFDocument.load(bytes);
  assert.ok(reloaded.getPageCount() >= 1);
  // The page size is fixed and portrait.
  const { width, height } = reloaded.getPage(0).getSize();
  assert.equal(Math.round(width), 612);
  assert.equal(Math.round(height), 792);
});

test("a long document paginates rather than overflowing", async () => {
  const bytes = await renderWorksheet(buildWorksheet("ss4", business, assessment));
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 2, "the SS-4 worksheet should need more than one page");
});

test("a blank value renders as a rule without breaking the PDF", async () => {
  // No EIN, no principal address: the greatest number of blank fields.
  const sparse = makeBusiness({ addresses: [], ein: undefined, people: [] });
  const bytes = await renderWorksheet(buildWorksheet("ss4", sparse, assessment));
  assert.equal(Buffer.from(bytes.subarray(0, 4)).toString("latin1"), "%PDF");
});

test("the official form is attached with its AcroForm intact", async (t) => {
  const blank = loadBlankForm();

  if (!blank) {
    t.diagnostic(
      `official form not fetched — skipping attachment test (run: node scripts/fetch-forms.mjs)`,
    );
    return;
  }

  const blankPageCount = (await PDFDocument.load(blank)).getPageCount();
  const bytes = await renderWorksheet(buildWorksheet("ss4", business, assessment), {
    attachOfficial: blank,
  });
  const doc = await PDFDocument.load(bytes);

  // The official form's pages come first, unmodified, then the worksheet.
  assert.ok(
    doc.getPageCount() > blankPageCount,
    `expected extra worksheet pages, got ${doc.getPageCount()} vs ${blankPageCount}`,
  );

  // Its AcroForm survives field-for-field.
  const originalFields = (await PDFDocument.load(blank)).getForm().getFields().length;
  const renderedFields = doc.getForm().getFields().length;
  assert.equal(renderedFields, originalFields);
  assert.ok(originalFields > 0, "the official form should carry form fields");
});

test("the official form is prefilled with only the reviewed fields", async (t) => {
  const blank = loadBlankForm();
  if (!blank) {
    t.diagnostic("official form not fetched — skipping prefill test");
    return;
  }

  const fill = fillSs4(business);
  const bytes = await renderWorksheet(buildWorksheet("ss4", business, assessment), {
    attachOfficial: blank,
    fillOfficial: fill,
  });
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();

  // Every value Genesis wrote read back, and the field count is unchanged.
  for (const [name, value] of Object.entries(fill.text)) {
    assert.equal(form.getTextField(name).getText(), value, `${name} did not read back`);
  }
  for (const name of Object.keys(fill.check)) {
    assert.equal(form.getCheckBox(name).isChecked(), true, `${name} is not checked`);
  }
  assert.equal(form.getFields().length, (await PDFDocument.load(blank)).getForm().getFields().length);

  // Nothing outside the whitelist moved: a field with no key stays empty.
  const written = new Set(Object.keys(fill.text));
  for (const alias of SS4_ALIASES) {
    if (alias.key || alias.kind !== "text") continue;
    if (written.has(alias.name)) continue;
    assert.equal(form.getTextField(alias.name).getText(), undefined, `${alias.label} was written after all`);
  }
});

test("a corrupt file in vendor/forms is not attached as a form", async (t) => {
  const target = blankFormPath("genesis-test-not-a-form.pdf");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from("<html>404 Not Found</html>"));

  try {
    assert.equal(loadBlankForm(target), null, "an HTML error page must not be attached");
  } finally {
    fs.unlinkSync(target);
  }

  t.diagnostic("verified: a non-PDF response is refused");
});
