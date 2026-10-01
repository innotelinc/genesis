import type { Business, EinFiling } from "../types";
import { principalAddress } from "../workflow/policy";

/**
 * The EIN filing: the third-party-designee path.
 *
 * The IRS restricts its *online* EIN assistant to the entity's responsible
 * party. A third-party designee — a firm filing on the business's behalf — is a
 * different route: Form SS-4, signed by the responsible party with the designee
 * block completed, filed by fax. Genesis takes that route only from a signature
 * the party actually gave, and it files the thing that was signed.
 *
 * Everything a person needs to complete it is generated here; the number the
 * filing goes to is configuration, because the IRS's fax table changes and a
 * stale line would send a filing nowhere.
 */

export const IRS_EIN_ONLINE_URL =
  "https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online";

export const IRS_SS4_INSTRUCTIONS_URL = "https://www.irs.gov/pub/irs-pdf/iss4.pdf";

/**
 * The IRS EIN fax line for a business.
 *
 * Resolution order, highest first:
 *   1. `IRS_EIN_FAX_BY_STATE` — a JSON object `{ "TX": "+1..." }`, keyed by the
 *      principal (falling back to the formation) state;
 *   2. `IRS_EIN_FAX_NUMBER` — one line for every business;
 *   3. none — the step stops and names the missing setting rather than guessing.
 *
 * The list itself lives in the SS-4 instructions ("Where To File"); copy the
 * row for the business's principal location.
 */
export function resolveEinFaxNumber(
  business: Business,
  env: Record<string, string | undefined>,
): string | undefined {
  const byState = env.IRS_EIN_FAX_BY_STATE?.trim();
  if (byState) {
    try {
      const table = JSON.parse(byState) as Record<string, string>;
      const state = (
        principalAddress(business)?.state ??
        business.formationState ??
        ""
      ).toUpperCase();
      const line = table[state];
      if (line && line.trim()) return line.trim();
    } catch {
      // A malformed table is an operator error. Fall through to the single line
      // rather than failing the filing over a typo in an unrelated variable.
    }
  }

  const single = env.IRS_EIN_FAX_NUMBER?.trim();
  return single || undefined;
}

/** True once the responsible party's signature (and named designee) is on record. */
export function filingAuthorized(business: Business): boolean {
  return Boolean(business.einFiling?.authorizedAt);
}

/** The designee named on the signed SS-4, or nothing when none is recorded. */
export function designeeOf(filing: EinFiling | undefined): EinFiling | undefined {
  if (!filing?.authorizedAt || !filing.designeeName) return undefined;
  return filing;
}

/** What the responsible party must do before Genesis may transmit anything. */
export function authorizationChecklist(business: Business): string[] {
  const rp = business.people[0];
  return [
    "Review the prefilled Form SS-4 and correct anything that is wrong at intake — do not edit the generated packet by hand.",
    "In the third-party designee block, name the firm filing for the business (its name, phone and fax), so the IRS knows who is acting for the entity.",
    ...(rp
      ? [`${rp.fullName} signs the SS-4 as the responsible party, and enters their own SSN/ITIN on line 7b.`]
      : ["The responsible party signs the SS-4, and enters their own SSN/ITIN on line 7b."]),
    "Return the signed copy — upload it on the EIN filing panel, or send it through Signara. Genesis files only the copy that was signed.",
  ];
}

/** A filename for the signed copy, stable per business. */
export function signedSs4Filename(business: Business): string {
  const slug = business.legalName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `ss4-signed-${slug || business.id}.pdf`;
}
