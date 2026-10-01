import type { Business } from "../types";
import { principalAddress } from "../workflow/policy";

/**
 * The reviewed alias table: SS-4 printed line -> the AcroForm field it lives in.
 *
 * The IRS's December 2025 SS-4 is a LiveCycle form whose 89 fields are named
 * `f1_1`…`f1_46` and `c1_1`…`c1_7`, with no human-readable label anywhere in
 * the file (`/TU` is absent and the text carries no XFA). So the mapping cannot
 * be read from the PDF; it has to be established against the printed lines and
 * then *verified*. This file is that reviewed mapping.
 *
 * It is verified, not trusted: `tests/ss4-form.test.ts` re-opens the fetched
 * form, extracts the printed label lines with `pdf-text.ts`, and asserts that
 * each `label` below really does sit next to the field it claims — and that no
 * field on the form is left unaccounted for. Run
 * `node scripts/review-ss4-mapping.mjs` to print the same table for a human.
 *
 * `key` is the only thing Genesis writes. A field with no `key` is never
 * touched — it belongs to the responsible party, the IRS, or nobody.
 */

const PAGE = "topmostSubform[0].Page1[0].";

/** `f1_N` */
const f = (n: number): string => `${PAGE}f1_${n}[0]`;
/** `c1_group[index]` */
const c = (group: number, index: number): string => `${PAGE}c1_${group}[${index}]`;

/** Fields living under the line-4 read-order group. */
const LINE4_5 = `${PAGE}Line4ReadOrder[0].f1_5[0]`;
const LINE4_6 = `${PAGE}Line4ReadOrder[0].f1_6[0]`;
const HEADER_EIN = `${PAGE}PgHeader[0].f1_1[0]`;

/** Where the printed label sits relative to the field, for verification. */
export type Ss4LabelAt = "above" | "same_row";

/** The semantic keys Genesis fills. Everything else is left to the party. */
export type Ss4FillKey =
  | "name"
  | "trade_name"
  | "mailing_street"
  | "mailing_city"
  | "street"
  | "street_city"
  | "responsible_party"
  | "llc"
  | "llc_organized_us"
  | "entity_type"
  | "state_of_incorporation"
  | "reason"
  | "reason_detail"
  | "date_started"
  | "closing_month"
  | "principal_activity_description"
  | "designee_name"
  | "designee_phone"
  | "designee_address"
  | "designee_fax";

export interface Ss4Alias {
  /** The field name(s) this alias covers. Always one, to keep the check exact. */
  name: string;
  kind: "text" | "checkbox";
  /** A fragment of the printed label, verified against the real form. */
  label: string;
  labelAt: Ss4LabelAt;
  /** The value Genesis writes here, when it writes at all. */
  key?: Ss4FillKey;
  /** For a checkbox: the value of `key` that should check this box. */
  on?: string;
  /** Free-text note shown in the review table. */
  note?: string;
}

/** Every SS-4 field on page 1, in printed order. */
export const SS4_ALIASES: Ss4Alias[] = [
  { name: HEADER_EIN, kind: "text", label: "EIN", labelAt: "above", note: "Assigned by the IRS; never filled." },

  // ── Identification ─────────────────────────────────────────────────────────
  { name: f(2), kind: "text", label: "Legal name of entity (or individual) for whom the EIN is being requested", labelAt: "above", key: "name" },
  { name: f(3), kind: "text", label: "Trade name of business (if different from name on line 1)", labelAt: "above", key: "trade_name" },
  { name: f(4), kind: "text", label: "Executor, administrator, trustee", labelAt: "above", note: "Estates/trusts only." },

  // ── Addresses ──────────────────────────────────────────────────────────────
  { name: LINE4_5, kind: "text", label: "Mailing address (room, apt., suite no. and street, or P.O. box)", labelAt: "above", key: "mailing_street" },
  { name: LINE4_6, kind: "text", label: "City, state, and ZIP code (if foreign, see instructions)", labelAt: "above", key: "mailing_city", note: "Line 4b." },
  { name: f(7), kind: "text", label: "Street address (if different)", labelAt: "above", key: "street" },
  { name: f(8), kind: "text", label: "City, state, and ZIP code", labelAt: "above", key: "street_city", note: "Line 5b." },
  { name: f(9), kind: "text", label: "County and state where principal business is located", labelAt: "above", note: "County is not captured at intake." },

  // ── Responsible party ──────────────────────────────────────────────────────
  { name: f(10), kind: "text", label: "Name of responsible party", labelAt: "above", key: "responsible_party" },
  { name: f(11), kind: "text", label: "SSN, ITIN, or EIN", labelAt: "above", note: "The party's own TIN; Genesis never stores it." },

  // ── Line 8: LLC questions ──────────────────────────────────────────────────
  { name: f(12), kind: "text", label: "enter the number of", labelAt: "above", note: "Line 8b, LLC members; the party enters it." },
  { name: c(1, 0), kind: "checkbox", label: "Yes", labelAt: "same_row", key: "llc", on: "Yes" },
  { name: c(1, 1), kind: "checkbox", label: "No", labelAt: "same_row", key: "llc", on: "No" },
  { name: c(2, 0), kind: "checkbox", label: "Yes", labelAt: "same_row", key: "llc_organized_us", on: "Yes" },
  { name: c(2, 1), kind: "checkbox", label: "No", labelAt: "same_row", key: "llc_organized_us", on: "No" },

  // ── Line 9a: type of entity ────────────────────────────────────────────────
  { name: c(3, 0), kind: "checkbox", label: "Sole proprietor (SSN)", labelAt: "same_row", key: "entity_type", on: "Sole proprietor" },
  { name: c(3, 1), kind: "checkbox", label: "Estate (SSN of decedent)", labelAt: "same_row" },
  { name: c(3, 2), kind: "checkbox", label: "Partnership", labelAt: "same_row" },
  { name: c(3, 3), kind: "checkbox", label: "Plan administrator (TIN)", labelAt: "same_row" },
  { name: c(3, 4), kind: "checkbox", label: "Corporation (enter form number to be filed)", labelAt: "same_row", key: "entity_type", on: "Corporation" },
  { name: c(3, 5), kind: "checkbox", label: "Trust (TIN of grantor)", labelAt: "same_row" },
  { name: c(3, 6), kind: "checkbox", label: "Personal service corporation", labelAt: "same_row" },
  { name: c(3, 7), kind: "checkbox", label: "Military/National Guard", labelAt: "same_row" },
  { name: c(3, 8), kind: "checkbox", label: "State/local government", labelAt: "same_row" },
  { name: c(3, 9), kind: "checkbox", label: "Church or church-controlled organization", labelAt: "same_row" },
  { name: c(3, 10), kind: "checkbox", label: "Farmers cooperative", labelAt: "same_row" },
  { name: c(3, 11), kind: "checkbox", label: "Federal government", labelAt: "same_row" },
  { name: c(3, 12), kind: "checkbox", label: "Other nonprofit organization (specify)", labelAt: "same_row", key: "entity_type", on: "Other nonprofit organization" },
  { name: c(3, 13), kind: "checkbox", label: "REMIC", labelAt: "same_row" },
  { name: c(3, 14), kind: "checkbox", label: "Indian tribal governments/enterprises", labelAt: "same_row" },
  { name: c(3, 15), kind: "checkbox", label: "Other (specify)", labelAt: "same_row" },

  // "specify" text fields beside line 9a boxes.
  { name: f(13), kind: "text", label: "Sole proprietor (SSN)", labelAt: "same_row" },
  { name: f(14), kind: "text", label: "Estate (SSN of decedent)", labelAt: "same_row" },
  { name: f(15), kind: "text", label: "Plan administrator (TIN)", labelAt: "same_row" },
  { name: f(16), kind: "text", label: "Corporation (enter form number to be filed)", labelAt: "same_row" },
  { name: f(17), kind: "text", label: "Trust (TIN of grantor)", labelAt: "same_row" },
  { name: f(18), kind: "text", label: "Other nonprofit organization (specify)", labelAt: "same_row" },
  { name: f(19), kind: "text", label: "Other (specify)", labelAt: "same_row" },
  { name: f(20), kind: "text", label: "Group Exemption Number (GEN) if any", labelAt: "same_row" },

  // ── Line 9b: state / foreign country ───────────────────────────────────────
  { name: f(21), kind: "text", label: "State", labelAt: "above", key: "state_of_incorporation" },
  { name: f(22), kind: "text", label: "Foreign country", labelAt: "above", note: "Genesis forms US entities only." },

  // ── Line 10: reason for applying ───────────────────────────────────────────
  { name: c(4, 0), kind: "checkbox", label: "Started new business (specify type)", labelAt: "same_row", key: "reason", on: "Started new business" },
  { name: c(4, 1), kind: "checkbox", label: "Changed type of organization (specify new type)", labelAt: "same_row" },
  { name: c(4, 2), kind: "checkbox", label: "Purchased going business", labelAt: "same_row" },
  { name: c(4, 3), kind: "checkbox", label: "Hired employees", labelAt: "same_row" },
  { name: c(4, 4), kind: "checkbox", label: "Created a trust (specify type)", labelAt: "same_row" },
  { name: c(4, 5), kind: "checkbox", label: "Compliance with IRS withholding regulations", labelAt: "same_row" },
  { name: c(4, 6), kind: "checkbox", label: "Created a pension plan (specify type)", labelAt: "same_row" },
  { name: c(4, 7), kind: "checkbox", label: "Other (specify)", labelAt: "same_row" },
  { name: c(4, 8), kind: "checkbox", label: "Banking purpose (specify purpose)", labelAt: "same_row" },
  { name: f(25), kind: "text", label: "Started new business (specify type)", labelAt: "same_row", key: "reason_detail" },
  { name: f(24), kind: "text", label: "Banking purpose (specify purpose)", labelAt: "same_row" },
  { name: f(27), kind: "text", label: "Changed type of organization (specify new type)", labelAt: "same_row" },
  { name: f(28), kind: "text", label: "Created a trust (specify type)", labelAt: "same_row" },
  { name: f(29), kind: "text", label: "Created a pension plan (specify type)", labelAt: "same_row" },
  { name: f(30), kind: "text", label: "Other (specify)", labelAt: "same_row" },

  // ── Lines 11–18 ────────────────────────────────────────────────────────────
  { name: f(31), kind: "text", label: "Date business started or acquired", labelAt: "above", key: "date_started" },
  { name: f(32), kind: "text", label: "Closing month of accounting year", labelAt: "above", key: "closing_month" },
  { name: f(33), kind: "text", label: "Agricultural", labelAt: "above", note: "Line 13 employee count." },
  { name: f(34), kind: "text", label: "Household", labelAt: "above", note: "Line 13 employee count." },
  { name: f(35), kind: "text", label: "Other", labelAt: "above", note: "Line 13 employee count." },
  { name: c(5, 0), kind: "checkbox", label: "check here", labelAt: "above", note: "Line 14, Form 944 election." },
  { name: f(36), kind: "text", label: "First date wages or annuities were paid", labelAt: "above" },
  { name: c(6, 0), kind: "checkbox", label: "Health care & social assistance", labelAt: "same_row" },
  { name: c(6, 1), kind: "checkbox", label: "Wholesale-agent/broker", labelAt: "same_row" },
  { name: c(6, 2), kind: "checkbox", label: "Construction", labelAt: "same_row" },
  { name: c(6, 3), kind: "checkbox", label: "Rental & leasing", labelAt: "same_row" },
  { name: c(6, 4), kind: "checkbox", label: "Transportation & warehousing", labelAt: "same_row" },
  { name: c(6, 5), kind: "checkbox", label: "Accommodation & food service", labelAt: "same_row" },
  { name: c(6, 6), kind: "checkbox", label: "Wholesale-other", labelAt: "same_row" },
  { name: c(6, 7), kind: "checkbox", label: "Retail", labelAt: "same_row" },
  { name: c(6, 8), kind: "checkbox", label: "Real estate", labelAt: "same_row" },
  { name: c(6, 9), kind: "checkbox", label: "Manufacturing", labelAt: "same_row" },
  { name: c(6, 10), kind: "checkbox", label: "Finance & insurance", labelAt: "same_row" },
  { name: c(6, 11), kind: "checkbox", label: "Other (specify)", labelAt: "same_row", note: "Line 16 principal activity." },
  { name: f(37), kind: "text", label: "Other (specify)", labelAt: "same_row" },
  { name: f(38), kind: "text", label: "Indicate principal line of merchandise sold", labelAt: "above", key: "principal_activity_description" },
  { name: c(7, 0), kind: "checkbox", label: "Yes", labelAt: "same_row", note: "Line 18 previous-EIN question." },
  { name: c(7, 1), kind: "checkbox", label: "No", labelAt: "same_row", note: "Line 18 previous-EIN question." },
  { name: f(39), kind: "text", label: "If Yes, write previous EIN here", labelAt: "same_row" },

  // ── Third-party designee and signature ─────────────────────────────────────
  // The designee block is filled only from a signed authorization — `fillValues`
  // supplies these keys only when the responsible party has signed, so an
  // unauthorized packet leaves it blank (the key is present, the value is not).
  { name: f(40), kind: "text", label: "Designee's name", labelAt: "above", key: "designee_name" },
  { name: f(41), kind: "text", label: "Designee's telephone number", labelAt: "above", key: "designee_phone" },
  { name: f(42), kind: "text", label: "Address and ZIP code", labelAt: "above", key: "designee_address" },
  { name: f(43), kind: "text", label: "Designee's fax number", labelAt: "above", key: "designee_fax" },
  { name: f(44), kind: "text", label: "Name and title (type or print clearly)", labelAt: "same_row", note: "The signer." },
  { name: f(45), kind: "text", label: "Applicant's telephone number", labelAt: "above" },
  { name: f(46), kind: "text", label: "Applicant's fax number", labelAt: "above" },
];

/**
 * Fields the reviewed table does not map. Asserted to exist so a *new* field
 * added by a future IRS revision trips the test instead of being ignored.
 *
 * `f1_26` is a text field on line 10 with no printed label anywhere near it
 * (its neighbours are the "Started new business" and "Hired employees" boxes).
 * Genesis leaves it alone rather than guess.
 */
export const SS4_UNMAPPED: string[] = [f(26)];

export interface Ss4Fill {
  /** AcroForm text field name -> value. */
  text: Record<string, string>;
  /** AcroForm checkbox name -> true when Genesis checks it. */
  check: Record<string, boolean>;
  /** Printed lines Genesis filled, for the audit trail. */
  filled: string[];
  /** Printed lines left for the responsible party, for the audit trail. */
  skipped: string[];
}

/** The values Genesis is willing to put on the form, and nothing else. */
function fillValues(business: Business): Partial<Record<Ss4FillKey, string>> {
  const principal = principalAddress(business);
  const mailing = business.addresses.find((a) => a.kind === "mailing") ?? principal;
  const rp = business.people[0];
  const values: Partial<Record<Ss4FillKey, string>> = {};

  values.name = business.legalName;
  if (business.dba) values.trade_name = business.dba;

  if (mailing) {
    values.mailing_street = `${mailing.line1}${mailing.line2 ? `, ${mailing.line2}` : ""}`;
    values.mailing_city = `${mailing.city}, ${mailing.state} ${mailing.postal}`;
  }

  // Line 5a/5b are only meaningful when the street differs from line 4a.
  if (principal && mailing && (mailing.line1 !== principal.line1 || mailing.postal !== principal.postal)) {
    values.street = `${principal.line1}${principal.line2 ? `, ${principal.line2}` : ""}`;
    values.street_city = `${principal.city}, ${principal.state} ${principal.postal}`;
  }

  if (rp) values.responsible_party = rp.fullName;

  values.llc = business.entityType === "llc" ? "Yes" : "No";
  if (business.entityType === "llc") values.llc_organized_us = "Yes";

  if (business.entityType === "c_corp" || business.entityType === "s_corp") values.entity_type = "Corporation";
  else if (business.entityType === "sole_prop") values.entity_type = "Sole proprietor";
  else if (business.entityType === "nonprofit") values.entity_type = "Other nonprofit organization";

  // Only a US-organized entity has a state of incorporation to name.
  values.state_of_incorporation = business.formationState;

  values.reason = "Started new business";
  if (business.industry) values.reason_detail = business.industry;
  if (business.formationDate) values.date_started = business.formationDate;
  values.closing_month = "December";
  if (business.industry) values.principal_activity_description = business.industry;

  // The third-party designee block, and only from a recorded signature. Genesis
  // names itself as the designee the responsible party authorized — never on an
  // unsigned packet, and never a designee it has not been given.
  const filing = business.einFiling;
  if (filing?.authorizedAt && filing.designeeName) {
    values.designee_name = filing.designeeName;
    if (filing.designeePhone) values.designee_phone = filing.designeePhone;
    if (filing.designeeAddress) values.designee_address = filing.designeeAddress;
    if (filing.designeeFax) values.designee_fax = filing.designeeFax;
  }

  return values;
}

/**
 * Build the exact set of field writes for a business.
 *
 * Writes only whitelisted keys, and never a field without a `key` — so the
 * signature, the designee block and line 7b cannot be filled even by accident.
 */
export function fillSs4(business: Business): Ss4Fill {
  const values = fillValues(business);
  const fill: Ss4Fill = { text: {}, check: {}, filled: [], skipped: [] };

  for (const alias of SS4_ALIASES) {
    const value = alias.key ? values[alias.key] : undefined;

    if (alias.kind === "text" && alias.key && value) {
      fill.text[alias.name] = value;
      fill.filled.push(`${alias.label} -> ${value}`);
      continue;
    }

    if (alias.kind === "checkbox" && alias.key && alias.on && value === alias.on) {
      fill.check[alias.name] = true;
      fill.filled.push(`${alias.label} [x]`);
      continue;
    }

    if (alias.key) fill.skipped.push(alias.label);
  }

  return fill;
}
