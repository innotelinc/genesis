import { test } from "node:test";
import assert from "node:assert/strict";

import {
  finalizeEinFiling,
  MAX_SS4_BYTES,
  parseEinFilingForm,
  type EinFilingFields,
} from "../src/lib/documents/ein-filing-request";
import type { EinFiling } from "../src/lib/types";

const NOW = () => "2026-09-30T12:00:00.000Z";

function form(entries: Record<string, string | File>): FormData {
  const f = new FormData();
  for (const [key, value] of Object.entries(entries)) f.append(key, value);
  return f;
}

function pdf(name = "ss4-signed.pdf", bytes = 64): File {
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}

const FIELDS: EinFilingFields = {
  designeeName: "Innotel Filing Services",
  authorizedAt: NOW(),
};

// ── parsing ───────────────────────────────────────────────────────────────────

test("a missing designee is refused", async () => {
  const result = await parseEinFilingForm(form({}), NOW);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /designee's name is required/i);
});

test("the authorization time defaults to now when it is not supplied", async () => {
  const result = await parseEinFilingForm(form({ designeeName: "Acme Filings" }), NOW);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.fields.authorizedAt, NOW());
});

test("a malformed authorization date is refused", async () => {
  const result = await parseEinFilingForm(
    form({ designeeName: "Acme Filings", authorizedAt: "not-a-date" }),
    NOW,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /ISO date-time/i);
});

test("a non-PDF signed copy is refused", async () => {
  const file = new File([new Uint8Array(16)], "ss4.png", { type: "image/png" });
  const result = await parseEinFilingForm(form({ designeeName: "Acme", file }), NOW);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /must be a PDF/i);
});

test("an oversized signed copy is refused", async () => {
  // One byte past the ceiling; the check is on the declared size.
  const file = pdf("big.pdf", MAX_SS4_BYTES + 1);
  const result = await parseEinFilingForm(form({ designeeName: "Acme", file }), NOW);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /under 10 MB/i);
});

test("an attached PDF comes back as bytes", async () => {
  const result = await parseEinFilingForm(
    form({ designeeName: "Acme", designeeFax: "+13025550101", file: pdf("signed.pdf", 42) }),
    NOW,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.file?.filename, "signed.pdf");
    assert.equal(result.file?.bytes.byteLength, 42);
    assert.equal(result.fields.designeeFax, "+13025550101");
  }
});

test("a Signara document id is carried through instead of a file", async () => {
  const result = await parseEinFilingForm(
    form({ designeeName: "Acme", signaraDocumentId: "doc_abc" }),
    NOW,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.fields.signaraDocumentId, "doc_abc");
    assert.equal(result.file, undefined);
  }
});

// ── merging with what is already recorded ─────────────────────────────────────

test("a first authorization is recorded as authorized", () => {
  const filing = finalizeEinFiling(FIELDS, undefined, { id: "/data/x.pdf", source: "upload" });

  assert.equal(filing.status, "authorized");
  assert.equal(filing.signedDocumentId, "/data/x.pdf");
  assert.equal(filing.signedDocumentSource, "upload");
  assert.equal(filing.faxId, undefined);
});

test("rewriting the authorization never drops a fax that already went out", () => {
  const previous: EinFiling = {
    ...FIELDS,
    status: "faxed",
    faxId: "fax_1",
    faxedAt: "2026-09-30T13:00:00.000Z",
    toFaxNumber: "+18559990000",
    signedDocumentId: "/data/old.pdf",
    signedDocumentSource: "upload",
  };

  // A new designee name, and no new signed copy supplied.
  const filing = finalizeEinFiling(
    { designeeName: "Someone Else", authorizedAt: "2026-10-01T00:00:00.000Z" },
    previous,
    undefined,
  );

  assert.equal(filing.status, "faxed", "an already-filed EIN stays filed");
  assert.equal(filing.faxId, "fax_1");
  assert.equal(filing.toFaxNumber, "+18559990000");
  assert.equal(filing.faxedAt, previous.faxedAt);
  assert.equal(filing.signedDocumentId, "/data/old.pdf", "the recorded copy is kept");
});

test("a new signed copy replaces the previous one", () => {
  const previous: EinFiling = { ...FIELDS, status: "authorized", signedDocumentId: "doc_old", signedDocumentSource: "signara" };
  const filing = finalizeEinFiling(FIELDS, previous, { id: "/data/new.pdf", source: "upload" });

  assert.equal(filing.signedDocumentId, "/data/new.pdf");
  assert.equal(filing.signedDocumentSource, "upload");
});

test("recording an authorization without a copy keeps the record honest", () => {
  const filing = finalizeEinFiling(FIELDS, undefined, undefined);
  assert.equal(filing.signedDocumentId, undefined);
  assert.equal(filing.signedDocumentSource, undefined);
});
