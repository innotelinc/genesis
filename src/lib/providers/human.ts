import type { ProviderKey } from "../types";
import type { ProviderResult, StepContext, StepProvider } from "./types";
import { napBlock } from "../documents/ss4";
import { principalAddress, validatePrincipalAddress } from "../workflow/policy";

/**
 * The human-attested providers.
 *
 * Every provider in this file is forbidden by `policy.ts` from performing an
 * external call — the institutions involved require the business's own
 * attestation, signature or identity check. What Genesis can honestly do is
 * *prepare*: assemble the form, the document packet, the canonical listing text,
 * and the exact place the person goes next.
 *
 * A provider here must never import a network client. The catalog test asserts
 * that each of these steps is paired with a `human` policy, and that no other
 * provider claims them.
 */

function prepared(
  detail: string,
  extras: Partial<ProviderResult> = {},
): ProviderResult {
  return { status: "awaiting_human", detail, ...extras };
}

function human(provider: ProviderKey, run: StepProvider["run"]): StepProvider {
  return { key: provider, run };
}

const addressProvider = human("address", async (ctx: StepContext) => {
  const problems = validatePrincipalAddress(ctx.business);
  const principal = principalAddress(ctx.business);

  if (problems.length > 0) {
    return prepared(
      "The principal place of business is not yet a valid street address. Correct it at intake before any filing.",
      {
        evidence: { problems },
        checklist: problems.map((p) => p.message),
      },
    );
  }

  return prepared(
    `Attest that the business operates from ${principal?.line1}, ${principal?.city}, ${principal?.state}.`,
    {
      evidence: { source: principal?.source, address: principal },
      checklist: [
        "Confirm this is where the business actually operates (not a mailbox, agent, or virtual office).",
        "Keep supporting evidence on file — a lease, a utility bill, or a property record.",
      ],
    },
  );
});

const stateProvider = human("state", async (ctx: StepContext) => {
  const state = ctx.business.formationState;
  return prepared(
    `File the formation documents with the ${state} Secretary of State and upload the stamped copy.`,
    {
      evidence: { formationState: state, entityType: ctx.business.entityType },
      checklist: [
        `Search the ${state} business registry to confirm the name is available.`,
        "File the articles of organization/incorporation and pay the state fee.",
        "Record the state entity ID and the formation date on the business record.",
        "Order the certified copy — banks and bureaus ask for it.",
      ],
    },
  );
});

const googleProvider = human("google", async (ctx: StepContext) => {
  return prepared(
    "The business owner creates and verifies the Google Business Profile at the operating address.",
    {
      actionUrl: "https://business.google.com/create",
      evidence: { nap: napBlock(ctx.business) },
      checklist: [
        "Use the exact legal/trade name and the operating address — Google verifies it by postcard, phone or video.",
        "Never list a virtual office, agent address, or a domain: Google suspends listings that have no real location.",
        "Add the business number from Zeus and the domain's email address.",
        "Complete verification before adding hours, photos or service areas.",
      ],
    },
  );
});

const bankProvider = human("bank", async (ctx: StepContext) => {
  const packet = [
    `Business: ${ctx.business.legalName}${ctx.business.dba ? ` (dba ${ctx.business.dba})` : ""}`,
    `Entity: ${ctx.business.entityType} · ${ctx.business.formationState}`,
    `EIN: ${ctx.business.ein ?? "(pending — the EIN step must complete first)"}`,
    "Documents: filed articles (certified), EIN letter (CP 575), operating agreement, photo ID of every signer, and the beneficial-ownership information for anyone with 25%+.",
  ].join("\n");

  return prepared(
    "Genesis prepares the account-opening packet. Opening the account requires the signer's identity and beneficial-ownership verification, so the owner completes it with the bank.",
    {
      evidence: { einOnFile: Boolean(ctx.business.ein) },
      artifacts: [{ name: "Account-opening packet", kind: "text", value: packet }],
      checklist: [
        "Shortlist accounts with no monthly fee and no minimum balance (free business checking).",
        "Bring the certified formation documents, the EIN letter, and the operating agreement.",
        "Every signer and every 25%+ owner completes identity verification — this cannot be delegated or automated.",
        "Use the principal place of business as the business address on the application.",
      ],
    },
  );
});

const dnbProvider = human("dnb", async (ctx: StepContext) => {
  return prepared(
    "Request the free D-U-N-S number; Dun & Bradstreet requires the business to attest to its own data.",
    {
      actionUrl: "https://www.dnb.com/duns-number/get-a-duns.html",
      evidence: { nap: napBlock(ctx.business) },
      checklist: [
        "Request the free D-U-N-S number for the legal entity (not the owner's personal credit).",
        "Use the exact legal name, the operating address, and the EIN.",
        "Expect a D&B verification call to the Zeus number — answer it.",
        "Record the D-U-N-S number on the business record once issued.",
      ],
    },
  );
});

const experianProvider = human("experian", async (ctx: StepContext) => {
  return prepared(
    "Establish the Experian Business credit file so tradelines report under the entity.",
    {
      actionUrl: "https://www.experian.com/small-business/business-credit-report",
      // Every bureau matches on the same identifiers; handing over the canonical
      // block keeps the three files from disagreeing about who the business is.
      evidence: { nap: napBlock(ctx.business) },
      checklist: [
        "Register the entity and confirm the file shows the correct legal name, address and EIN.",
        "Match the listed name, address and phone exactly to the other two bureaus.",
        "Ask vendors that grant net terms to report to Experian.",
        "Enable monitoring so a dispute or a fraud attempt is visible.",
      ],
    },
  );
});

const equifaxProvider = human("equifax", async (ctx: StepContext) => {
  return prepared(
    "Establish the Equifax Business credit file — the third bureau in a Tier 1 profile.",
    {
      actionUrl: "https://www.equifax.com/business/",
      evidence: { nap: napBlock(ctx.business) },
      checklist: [
        "Register the entity and confirm the file matches the other two bureaus exactly.",
        "Flag any shared tradeline the other files already report.",
        "Add business tradelines that report to Equifax.",
        "Enable monitoring.",
      ],
    },
  );
});

const listingsProvider = human("listings", async (ctx: StepContext) => {
  const nap = napBlock(ctx.business).join("\n");
  return prepared(
    "Publish white/yellow-pages style listings using one canonical NAP block so every directory matches.",
    {
      evidence: { nap: napBlock(ctx.business) },
      artifacts: [{ name: "Canonical NAP block", kind: "text", value: nap }],
      checklist: [
        "Submit the same name, address and phone to every directory — mismatches suppress the listing and hurt the bureaus' matching.",
        "Directories verify the business owner, so complete each submission personally.",
        "Link the domain and the business email from the Oasis step.",
      ],
    },
  );
});

export const HUMAN_PROVIDERS: Partial<Record<ProviderKey, StepProvider>> = {
  address: addressProvider,
  state: stateProvider,
  google: googleProvider,
  bank: bankProvider,
  dnb: dnbProvider,
  experian: experianProvider,
  equifax: equifaxProvider,
  listings: listingsProvider,
};
