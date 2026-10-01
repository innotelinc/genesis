import type { Address, Attestation, Business, ProviderKey } from "../types";

/**
 * Genesis's automation policy — the guardrail layer.
 *
 * Genesis orchestrates a business launch, and orchestration is where a naive
 * implementation does real harm: scripting the IRS, opening a bank account, or
 * creating a Google listing on someone's behalf is either barred by the
 * institution, by law, or both — and a fabricated address turns "helping" into
 * a false statement on a government filing.
 *
 * So the policy is explicit and enforced in code:
 *
 *   - exactly four providers may be driven by an API (the platforms this stack
 *     owns: Zeus, Cerulean, Oasis, Magnate);
 *   - every other provider is human-attested, and `assertAutomationAllowed`
 *     refuses to automate it no matter who calls;
 *   - a principal place of business must be a real street address — never a
 *     domain, a URL, or a virtual/agent address.
 *
 * Nothing in the app should reach an external institution without going through
 * this module first.
 */

export class PolicyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PolicyError";
    this.code = code;
  }
}

export type ProviderMode = "automated" | "assisted" | "human";

export interface ProviderPolicy {
  mode: ProviderMode;
  reason: string;
}

/**
 * The complete provider policy. `mode: "human"` means the step is completed by
 * a person who attests to it; Genesis may only prepare artifacts and track it.
 */
export const PROVIDER_POLICY: Record<ProviderKey, ProviderPolicy> = {
  zeus: {
    mode: "automated",
    reason: "Zeus (VoiceOps) owns number provisioning and exposes it as an API.",
  },
  cerulean: {
    mode: "automated",
    reason: "Cerulean (TrustOps) owns DNS, proxy hosts and certificate lifecycle for the zone.",
  },
  oasis: {
    mode: "automated",
    reason: "Oasis (MailOps) owns mailboxes on a domain it hosts.",
  },
  magnate: {
    mode: "automated",
    reason: "Magnate (RevenueOps) owns subscriptions; creating one is a normal API call.",
  },
  address: {
    mode: "human",
    reason:
      "Where a business actually operates is an attestation by its owner — Genesis only validates the shape of the address.",
  },
  state: {
    mode: "human",
    reason:
      "Formation statutes require the filer's signature and fee; the Secretary of State accepts the filing from the entity, not a bot.",
  },
  irs: {
    mode: "assisted",
    reason:
      "The IRS restricts its online EIN assistant to the entity's responsible party, but a third-party designee may file Form SS-4 by fax with that party's signed authorization. Genesis prepares the form, records the signature, and transmits only what was signed.",
  },
  google: {
    mode: "human",
    reason:
      "Google verifies a real, staffed location and suspends listings that don't have one; programmatic creation violates its guidelines.",
  },
  bank: {
    mode: "human",
    reason:
      "Account opening requires the signer's identity and beneficial-ownership verification under KYC rules; no bank permits it to be automated.",
  },
  dnb: {
    mode: "human",
    reason: "Dun & Bradstreet requires the business itself to attest to the data in its file.",
  },
  experian: {
    mode: "human",
    reason: "Experian Business onboarding requires the business's own attestation.",
  },
  equifax: {
    mode: "human",
    reason: "Equifax Business onboarding requires the business's own attestation.",
  },
  listings: {
    mode: "human",
    reason: "Directories verify the business owner before publishing; Genesis supplies a matching NAP block.",
  },
};

export function providerPolicy(provider: ProviderKey): ProviderPolicy {
  return PROVIDER_POLICY[provider];
}

export function isHumanOnly(provider: ProviderKey): boolean {
  return PROVIDER_POLICY[provider].mode === "human";
}

export function canAutomate(provider: ProviderKey): boolean {
  return PROVIDER_POLICY[provider].mode === "automated";
}

export function providerMode(provider: ProviderKey): ProviderMode {
  return PROVIDER_POLICY[provider].mode;
}

/**
 * `assisted` means the step *may* reach an institution, but only through an act
 * the responsible party performed first — a signature, an authorization. It is
 * neither fully automated nor human-only.
 */
export function requiresAttestation(provider: ProviderKey): boolean {
  return PROVIDER_POLICY[provider].mode === "assisted";
}

/**
 * The single choke point before any external call. Throws rather than returning
 * a boolean so a missing check cannot be silently ignored.
 *
 * A `human` provider is refused outright. An `assisted` provider is refused
 * *unless* the caller can show the attestation it depends on — so the guard
 * holds at the moment of transmission, not merely at the moment of dispatch.
 */
export function assertAutomationAllowed(
  provider: ProviderKey,
  attestation?: Attestation,
): void {
  const policy = PROVIDER_POLICY[provider];
  if (policy.mode === "human") {
    throw new PolicyError(
      "automation_not_permitted",
      `The "${provider}" step cannot be automated. ${policy.reason}`,
    );
  }
  if (policy.mode === "assisted" && !attestation) {
    throw new PolicyError(
      "attestation_required",
      `The "${provider}" step may be transmitted only after the responsible party's signed authorization is on record. ${policy.reason}`,
    );
  }
}

/**
 * The attestation a provider depends on, read from the record.
 *
 * Kept here rather than in the provider so the executor and the provider reach
 * the same conclusion from the same place.
 */
export function attestationFor(
  provider: ProviderKey,
  business: Business,
): Attestation | undefined {
  if (provider !== "irs") return undefined;
  const filing = business.einFiling;
  if (!filing?.authorizedAt) return undefined;
  return { authorizedAt: filing.authorizedAt, reference: filing.signedDocumentId };
}

export function automatedProviders(): ProviderKey[] {
  return (Object.keys(PROVIDER_POLICY) as ProviderKey[]).filter((p) => canAutomate(p));
}

export function assistedProviders(): ProviderKey[] {
  return (Object.keys(PROVIDER_POLICY) as ProviderKey[]).filter((p) => requiresAttestation(p));
}

// ── address validation ────────────────────────────────────────────────────────

export interface AddressProblem {
  field: string;
  message: string;
}

/** Anything that reads as a domain, URL or email rather than a street. */
export function looksLikeDomainOrUrl(value: string): boolean {
  const v = value.trim();
  if (v === "") return false;
  if (/@/.test(v)) return true;
  if (/^https?:\/\//i.test(v)) return true;
  if (/(^|\s)([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(v)) return true;
  return false;
}

export function validateAddress(address: Address): AddressProblem[] {
  const problems: AddressProblem[] = [];
  const line1 = (address.line1 ?? "").trim();

  if (line1 === "") {
    problems.push({ field: "line1", message: "A street address is required." });
  } else if (looksLikeDomainOrUrl(line1)) {
    problems.push({
      field: "line1",
      message: "A domain, URL or email address is not a street address.",
    });
  } else if (!/\d/.test(line1)) {
    problems.push({
      field: "line1",
      message: "The street address needs a street number.",
    });
  }

  if (!(address.city ?? "").trim()) {
    problems.push({ field: "city", message: "A city is required." });
  }
  if (!/^[A-Za-z]{2}$/.test((address.state ?? "").trim())) {
    problems.push({ field: "state", message: "A two-letter state code is required." });
  }
  if (!/^\d{5}(-\d{4})?$/.test((address.postal ?? "").trim())) {
    problems.push({ field: "postal", message: "A 5- or 9-digit postal code is required." });
  }
  if (!(address.country ?? "").trim()) {
    problems.push({ field: "country", message: "A country is required." });
  }

  return problems;
}

export function principalAddress(business: Business): Address | undefined {
  return business.addresses.find((a) => a.kind === "principal");
}

/**
 * The principal place of business rules. Stricter than `validateAddress`: the
 * address must be one the business actually operates from, so a registered
 * agent or virtual office can never fill this role.
 */
export function validatePrincipalAddress(business: Business): AddressProblem[] {
  const address = principalAddress(business);
  if (!address) {
    return [
      {
        field: "principal",
        message: "No principal place of business is on record for this business.",
      },
    ];
  }

  const problems = validateAddress(address);

  if (address.source === "virtual_office" || address.source === "registered_agent") {
    problems.push({
      field: "source",
      message:
        "A virtual office or registered agent address can be the mailing or agent address, but not the principal place of business on a filing.",
    });
  }

  return problems;
}

export function assertPrincipalAddress(business: Business): void {
  const problems = validatePrincipalAddress(business);
  if (problems.length > 0) {
    throw new PolicyError(
      "invalid_principal_address",
      problems.map((p) => p.message).join(" "),
    );
  }
}

/** The policy, rendered for the docs and the operator UI. */
export function policySummary(): { provider: ProviderKey; mode: ProviderMode; reason: string }[] {
  return (Object.keys(PROVIDER_POLICY) as ProviderKey[]).map((provider) => ({
    provider,
    ...PROVIDER_POLICY[provider],
  }));
}
