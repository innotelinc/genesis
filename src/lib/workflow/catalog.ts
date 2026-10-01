import type { Phase, StepDefinition } from "../types";

/**
 * The Genesis step catalog — the ordered set of jobs that turn a business idea
 * into a registered, reachable, bankable, credit-visible entity.
 *
 * Each step names the platform that does the work (`provider`). Providers are
 * automated (Zeus, Cerulean, Oasis, Magnate), assisted (the IRS — transmitted by
 * Genesis only from a signed third-party-designee authorization), or
 * human-attested (the credit bureaus, a bank, Google). `policy.ts` is the single
 * place that decides which is which and refuses a step that is not permitted to
 * run.
 */

export const PHASES: { key: Phase; title: string; summary: string }[] = [
  {
    key: "entity",
    title: "Entity & identity",
    summary: "The legal person: a real operating address, the state filing, and the EIN.",
  },
  {
    key: "presence",
    title: "Presence",
    summary: "How customers and the registry reach the business: number, domain, mail, profile.",
  },
  {
    key: "money",
    title: "Banking & billing",
    summary: "Where money lands and how the platform is paid for.",
  },
  {
    key: "credit",
    title: "Credit & listings",
    summary: "Tier 1 readiness: a D-U-N-S number, bureau files, and directory listings.",
  },
];

export const STEP_CATALOG: StepDefinition[] = [
  {
    key: "principal_address",
    phase: "entity",
    title: "Confirm the principal place of business",
    provider: "address",
    requiresHuman: true,
    dependsOn: [],
    summary:
      "A real street address where the business actually operates. A domain name is not an address, and a virtual office or registered agent address cannot be attested as the principal place of business on a filing.",
    deliverables: ["Verified principal address on record"],
  },
  {
    key: "entity_formation",
    phase: "entity",
    title: "Form the legal entity",
    provider: "state",
    requiresHuman: true,
    dependsOn: ["principal_address"],
    summary:
      "File the articles of organization/incorporation with the formation state's Secretary of State and receive the stamped formation documents.",
    deliverables: ["Filed articles", "State entity ID", "EIN-ready formation date"],
  },
  {
    key: "ein_application",
    phase: "entity",
    title: "Apply for an EIN",
    provider: "irs",
    requiresHuman: false,
    dependsOn: ["entity_formation"],
    summary:
      "Genesis prefills Form SS-4 with everything it holds. The responsible party reviews and signs it, naming Genesis as third-party designee; once that signature is on record Genesis faxes the signed form to the IRS EIN line and tracks the filing. Genesis prepares, and transmits only what was signed — the IRS online assistant itself is restricted to the responsible party.",
    officialUrl:
      "https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online",
    deliverables: ["Signed SS-4", "Filed EIN application", "EIN confirmation letter (CP 575)"],
  },
  {
    key: "phone_number",
    phase: "presence",
    title: "Provision a business phone number",
    provider: "zeus",
    requiresHuman: false,
    dependsOn: [],
    summary:
      "Order a DID through Zeus (VoiceOps) and attach it to an extension, so the number is answerable and can be listed publicly.",
    deliverables: ["Active DID", "Extension bound to the number"],
  },
  {
    key: "domain_registration",
    phase: "presence",
    title: "Register the domain and its TLS zone",
    provider: "cerulean",
    requiresHuman: false,
    dependsOn: [],
    summary:
      "Register the business domain and let Cerulean (TrustOps) own the zone's DNS records and wildcard certificate.",
    deliverables: ["Registered domain", "Zone records", "Wildcard TLS certificate"],
  },
  {
    key: "mail_hosting",
    phase: "presence",
    title: "Host the domain mail",
    provider: "oasis",
    requiresHuman: false,
    dependsOn: ["domain_registration"],
    summary:
      "Create the mailbox on Oasis (MailOps) so the business has a real, branded email address on its own domain — the business's email address to the world.",
    deliverables: ["Mailbox on the business domain", "SPF/DKIM/DMARC posture", "Business email address"],
  },
  {
    key: "google_business_profile",
    phase: "presence",
    title: "Create the Google Business Profile",
    provider: "google",
    requiresHuman: true,
    dependsOn: ["principal_address", "phone_number"],
    summary:
      "Google requires a real, staffed location and verifies it; it suspends listings that use a virtual or non-existent address. The business owner claims and verifies the profile.",
    officialUrl: "https://business.google.com/create",
    deliverables: ["Verified profile", "Listed hours and service area"],
  },
  {
    key: "business_bank_account",
    phase: "money",
    title: "Open a business bank account",
    provider: "bank",
    requiresHuman: true,
    dependsOn: ["ein_application", "principal_address", "entity_formation"],
    summary:
      "Genesis shortlists free business checking accounts and prepares the document packet. Account opening requires the signer's identity and beneficial-ownership verification; no bank permits it to be automated.",
    deliverables: ["Business checking account", "Documented beneficial owners (BOI)"],
  },
  {
    key: "billing_account",
    phase: "money",
    title: "Set up the platform subscription",
    provider: "magnate",
    requiresHuman: false,
    dependsOn: ["ein_application"],
    optional: true,
    summary:
      "Create the Magnate (RevenueOps) subscription that bills for Genesis itself and gates paid seats.",
    deliverables: ["Magnate subscription", "Entitlements on the client record"],
  },
  {
    key: "dnb_duns",
    phase: "credit",
    title: "Register for a D-U-N-S number",
    provider: "dnb",
    requiresHuman: true,
    dependsOn: ["ein_application", "principal_address"],
    summary:
      "The free D-U-N-S number is the key to Dun & Bradstreet's business credit file. Genesis prepares the request; the business owner attests and submits it.",
    officialUrl: "https://www.dnb.com/duns-number/get-a-duns.html",
    deliverables: ["D-U-N-S number", "D&B business credit file"],
  },
  {
    key: "experian_business",
    phase: "credit",
    title: "Establish the Experian business file",
    provider: "experian",
    requiresHuman: true,
    dependsOn: ["ein_application", "business_bank_account"],
    summary:
      "Register the entity with Experian Business so tradelines report under the business, not the owner. The business attests to its own data.",
    officialUrl: "https://www.experian.com/small-business/business-credit-report",
    deliverables: ["Experian business credit file", "Monitoring enabled"],
  },
  {
    key: "equifax_business",
    phase: "credit",
    title: "Establish the Equifax business file",
    provider: "equifax",
    requiresHuman: true,
    dependsOn: ["ein_application", "business_bank_account"],
    summary:
      "Register the entity with Equifax Business to open the third bureau file. Attested by the business owner, like Experian.",
    officialUrl: "https://www.equifax.com/business/",
    deliverables: ["Equifax business credit file", "Monitoring enabled"],
  },
  {
    key: "directory_listings",
    phase: "credit",
    title: "Publish directory listings",
    provider: "listings",
    requiresHuman: true,
    dependsOn: ["phone_number", "domain_registration", "principal_address"],
    summary:
      "White- and yellow-pages style listings with a consistent name, address and phone (NAP). Directories verify the business before publishing, so the owner completes them; Genesis generates the canonical NAP block so every listing matches.",
    deliverables: ["Consistent NAP block", "Published directory listings"],
  },
];

const BY_KEY = new Map(STEP_CATALOG.map((s) => [s.key, s]));

export function stepDefinition(key: string): StepDefinition | undefined {
  return BY_KEY.get(key);
}

export function stepsInPhase(phase: Phase): StepDefinition[] {
  return STEP_CATALOG.filter((s) => s.phase === phase);
}
