import type { Business } from "../types";
import { principalAddress } from "../workflow/policy";

/**
 * Form SS-4 (Application for Employer Identification Number) mapping.
 *
 * The printed line structure below is the **December 2025** revision
 * (`(Rev. 12-2025)`, Cat. No. 16055N) — the one `scripts/fetch-forms.mjs`
 * downloads. `tests/ss4-form.test.ts` re-reads the fetched PDF and asserts the
 * revision string, so a future IRS revision fails loudly instead of silently
 * shifting a value into the wrong box.
 *
 * Genesis prepares the application. The responsible party signs it; Genesis may
 * then file it as third-party designee (see `providers/irs.ts`), but two things
 * are deliberately never filled from our data:
 *
 *   - line 7b, the responsible party's full SSN/ITIN/EIN — Genesis stores only
 *     the last four, and the IRS does not want a third party supplying it;
 *   - the signature block — Genesis cannot sign for the applicant.
 *
 * The third-party designee block is filled **only** from a recorded signature,
 * naming the firm the party authorized — never on an unsigned packet.
 *
 * Everything else is prefilled so the person is copying, not reconstructing.
 * The AcroForm field names those values land in live in `ss4-fields.ts`.
 */

export type Ss4ValueState = "filled" | "needs_party" | "not_applicable";

export interface Ss4Field {
  line: string;
  label: string;
  value: string;
  state: Ss4ValueState;
  note?: string;
}

const BLANK = "________________";

function field(
  line: string,
  label: string,
  value: string,
  state: Ss4ValueState = "filled",
  note?: string,
): Ss4Field {
  return note ? { line, label, value, state, note } : { line, label, value, state };
}

function entityAnswer(business: Business): string {
  return business.entityType === "llc" ? "Yes" : "No";
}

/** The line 9a box a given entity type checks, when the answer is unambiguous. */
function entityBox(business: Business): string | undefined {
  switch (business.entityType) {
    case "c_corp":
    case "s_corp":
      return "Corporation";
    case "sole_prop":
      return "Sole proprietor";
    case "nonprofit":
      return "Other nonprofit organization";
    // An LLC checks the box for how it is *taxed*; the instructions to line 8a
    // say which. Genesis does not choose the LLC's tax classification.
    case "llc":
      return undefined;
  }
}

function cityLine(address: { city: string; state: string; postal: string }): string {
  return `${address.city}, ${address.state} ${address.postal}`;
}

/**
 * The third-party designee line.
 *
 * Before the party signs there is no designee to name, and the line reads as not
 * applicable. Once a designee and a signature are on record, it carries them —
 * matching exactly what lands in the form's `f1_40`–`f1_43` fields.
 */
function designeeLine(business: Business): Ss4Field {
  const filing = business.einFiling;
  if (!filing?.authorizedAt || !filing.designeeName) {
    return field(
      "Third-party designee",
      "Third-party designee (name, phone, fax, address)",
      "",
      "not_applicable",
      "Genesis acts as third-party designee only from the responsible party's signed authorization.",
    );
  }

  const parts = [filing.designeeName];
  if (filing.designeePhone) parts.push(filing.designeePhone);
  if (filing.designeeFax) parts.push(`fax ${filing.designeeFax}`);
  if (filing.designeeAddress) parts.push(filing.designeeAddress);

  return field("Third-party designee", "Third-party designee (name, phone, fax, address)", parts.join(" · "));
}

/** The canonical NAP block, reused by lists that other steps hand to humans. */
export function napBlock(business: Business): string[] {
  const principal = principalAddress(business);
  const phone = business.people[0]?.phone ?? "";
  const lines = [business.dba || business.legalName];
  if (principal) {
    lines.push(`${principal.line1}${principal.line2 ? `, ${principal.line2}` : ""}`);
    lines.push(cityLine(principal));
  }
  if (phone) lines.push(phone);
  if (business.websiteDomain) lines.push(business.websiteDomain);
  return lines;
}

export function buildSs4(business: Business): Ss4Field[] {
  const principal = principalAddress(business);
  const mailing = business.addresses.find((a) => a.kind === "mailing") ?? principal;
  const rp = business.people[0];
  const isLlc = business.entityType === "llc";

  const mailingStreet = mailing
    ? `${mailing.line1}${mailing.line2 ? `, ${mailing.line2}` : ""}`
    : BLANK;
  // Line 5a is only filled when it differs from 4a; when there is no separate
  // mailing address, 4a already carries the principal address.
  const separateStreet =
    principal && mailing && (mailing.line1 !== principal.line1 || mailing.postal !== principal.postal);

  return [
    field("1", "Name of entity (or individual) for whom the EIN is being requested", business.legalName),
    business.dba
      ? field("2", "Trade name of business (if different from name on line 1)", business.dba)
      : field("2", "Trade name of business (if different from name on line 1)", "", "not_applicable", "No trade name."),
    field(
      "3",
      'Executor, administrator, trustee, "care of" name',
      "",
      "not_applicable",
      "Only estates, trusts and care-of filings use line 3.",
    ),
    mailing
      ? field("4a", "Mailing address (room, apt., suite no. and street, or P.O. box)", mailingStreet)
      : field("4a", "Mailing address (room, apt., suite no. and street, or P.O. box)", BLANK, "needs_party", "No mailing address on record."),
    mailing
      ? field("4b", "City, state, and ZIP code (if foreign, see instructions)", cityLine(mailing))
      : field("4b", "City, state, and ZIP code (if foreign, see instructions)", BLANK, "needs_party", "No mailing address on record."),
    principal && separateStreet
      ? field("5a", "Street address (if different from 4a)", `${principal.line1}${principal.line2 ? `, ${principal.line2}` : ""}`)
      : field("5a", "Street address (if different from 4a)", "", "not_applicable", "Only used when the street address differs from line 4a."),
    principal && separateStreet
      ? field("5b", "City, state, and ZIP code (if foreign, see instructions)", cityLine(principal))
      : field("5b", "City, state, and ZIP code (if foreign, see instructions)", "", "not_applicable", "Only used when the street address differs from line 4a."),
    field(
      "6",
      "County and state where principal business is located",
      "",
      "needs_party",
      "The county is not captured during intake; the responsible party completes it.",
    ),
    rp
      ? field("7a", "Name of responsible party", rp.fullName)
      : field("7a", "Name of responsible party", BLANK, "needs_party", "No responsible party on record."),
    field(
      "7b",
      "SSN/ITIN/EIN of responsible party",
      "",
      "needs_party",
      "Genesis never stores a full SSN/ITIN. The responsible party enters it.",
    ),
    field("8a", "Is this application for an LLC (or foreign equivalent)?", entityAnswer(business)),
    isLlc
      ? field("8b", "Number of LLC members", "", "needs_party", "The responsible party enters the member count.")
      : field("8b", "Number of LLC members", "", "not_applicable"),
    isLlc
      ? field("8c", "If 8a is Yes, was the LLC organized in the United States?", "Yes")
      : field("8c", "If 8a is Yes, was the LLC organized in the United States?", "", "not_applicable"),
    entityBox(business)
      ? field("9a", "Type of entity", entityBox(business) as string)
      : field(
          "9a",
          "Type of entity",
          "",
          "needs_party",
          "An LLC checks the box for how it is taxed — the instructions to line 8a say which.",
        ),
    field("9b", "If a corporation, name the state or foreign country where incorporated", business.formationState),
    field("10", "Reason for applying", "Started new business"),
    business.formationDate
      ? field("11", "Date business started or acquired", business.formationDate)
      : field("11", "Date business started or acquired", "", "needs_party", "Set by the formation filing date."),
    field("12", "Closing month of accounting year", "December"),
    field(
      "13",
      "Highest number of employees expected in the next 12 months",
      "",
      "needs_party",
      "Agricultural / household / other counts are the owner's estimate.",
    ),
    field("14", "Check here to file Form 944 annually instead of Form 941 quarterly", "", "not_applicable"),
    field("15", "First date wages or annuities were paid", "", "needs_party", "Only if the business has employees."),
    field(
      "16",
      "Principal activity",
      "",
      "needs_party",
      "The responsible party checks the box that best describes the business.",
    ),
    field("17", "Describe the principal activity", business.industry ?? "", business.industry ? "filled" : "needs_party"),
    field("18", "Previous EIN", "", "not_applicable", "A newly formed entity has none."),
    designeeLine(business),
    field(
      "Signature",
      "Signer's name, title, signature and date",
      "",
      "needs_party",
      "The responsible party signs. Genesis files the signed copy as third-party designee; it never signs.",
    ),
  ];
}

export function ss4Missing(fields: Ss4Field[]): string[] {
  return fields.filter((f) => f.state === "needs_party").map((f) => `Line ${f.line} — ${f.label}`);
}

export function ss4Filename(business: Business): string {
  const slug = business.legalName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `ss4-${slug || business.id}.txt`;
}

/** A printable prefill — the person copies it onto the official form. */
export function renderSs4Text(business: Business): string {
  const fields = buildSs4(business);
  const width = 34;
  const lines: string[] = [];

  lines.push("Form SS-4 — Application for Employer Identification Number");
  lines.push("PREPARED BY GENESIS (BusinessOps). NOT A SUBMISSION.");
  lines.push("");
  lines.push("The IRS restricts the online EIN assistant to the responsible party.");
  lines.push("Review every line, complete the blank fields by hand, and submit it yourself:");
  lines.push("https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online");
  lines.push("");
  lines.push("-".repeat(72));

  for (const f of fields) {
    const label = `Line ${f.line}  ${f.label}`;
    lines.push(label);
    if (f.state === "not_applicable") {
      lines.push(`  ${"n/a".padEnd(width)}`);
    } else if (f.state === "needs_party") {
      lines.push(`  ${BLANK.padEnd(width)}   <- responsible party`);
    } else {
      lines.push(`  ${f.value}`);
    }
    if (f.note) lines.push(`  note: ${f.note}`);
    lines.push("");
  }

  lines.push("-".repeat(72));
  lines.push("Canonical NAP block (keep every listing identical):");
  for (const l of napBlock(business)) lines.push(`  ${l}`);

  return lines.join("\n");
}
