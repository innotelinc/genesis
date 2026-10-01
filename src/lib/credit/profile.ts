import type { Business, StepState } from "../types";
import { validatePrincipalAddress } from "../workflow/policy";
import type { CreditProfile, Tradeline } from "./model";

/**
 * Build the credit profile from what Genesis already knows.
 *
 * The rule is that a fact counts only when the step that produces it is
 * genuinely finished — a queued mailbox does not make an email address exist,
 * and a completed checklist item does not make an EIN real. Anything derived
 * from a step's completion is noted as such, so the score can be read honestly.
 */
export function creditProfileFor(
  business: Business,
  states: StepState[],
  tradelines: Tradeline[],
): CreditProfile {
  const byKey = new Map(states.map((s) => [s.key, s]));
  const isComplete = (key: string) => byKey.get(key)?.status === "complete";

  // The bank step's completion date is the only date we have for the account;
  // it is the day the operator recorded the account, not the day it opened.
  const bankCompletedAt = isComplete("business_bank_account")
    ? byKey.get("business_bank_account")?.updatedAt
    : undefined;

  return {
    ein: business.ein,
    duns: business.duns,
    formationDate: business.formationDate,
    bankAccountOpenedAt: bankCompletedAt,
    hasBusinessAddress: validatePrincipalAddress(business).length === 0,
    hasBusinessPhone: isComplete("phone_number"),
    // Both halves are required: a registered domain with no mailbox is not an
    // email address a bureau can reach the business at.
    hasDomainAndEmail: isComplete("domain_registration") && isComplete("mail_hosting"),
    tradelines,
  };
}
