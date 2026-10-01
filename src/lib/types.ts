/**
 * Genesis domain types.
 *
 * Everything here is transport-agnostic: the engine, the policies and the
 * provider clients operate on these shapes, which is why they carry no Next.js
 * or database imports and stay unit-testable.
 */

export type EntityType = "llc" | "s_corp" | "c_corp" | "sole_prop" | "nonprofit";

export type AddressKind = "principal" | "mailing" | "registered_agent";

/**
 * Where an address physically comes from. Only `owned` and `home` may serve as
 * the principal place of business — a registered agent or virtual office is a
 * mailing/agent address, never the place the business actually operates.
 */
export type AddressSource = "owned" | "home" | "registered_agent" | "virtual_office";

export interface Address {
  kind: AddressKind;
  source: AddressSource;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal: string;
  country: string;
}

export interface ResponsibleParty {
  fullName: string;
  role: string;
  email: string;
  phone?: string;
  /** Last four only. Genesis never stores a full SSN/ITIN. */
  ssnLast4?: string;
  address?: Address;
}

/**
 * An authorization the responsible party has signed.
 *
 * Its *presence* is the permission: a provider whose policy is `assisted` may
 * transmit only when it holds one. The `reference` names the signed artifact the
 * transmission is made from, so the thing filed is the thing that was signed.
 */
export interface Attestation {
  /** When the responsible party signed. */
  authorizedAt: string;
  /** Where the signed artifact lives (a Signara document id, or a stored path). */
  reference?: string;
}

export type EinFilingStatus = "authorized" | "faxed" | "accepted" | "rejected";

/**
 * The EIN filing record: who signed, who Genesis acts for, and what happened.
 *
 * The IRS restricts its *online* EIN assistant to the entity's responsible
 * party, but a third-party designee may file Form SS-4 by fax with the party's
 * signed authorization. This record is that authorization and its outcome —
 * Genesis prepares and transmits; it never signs for the applicant.
 */
export interface EinFiling {
  /** The designee named on the signed SS-4 (the firm filing on the business's behalf). */
  designeeName: string;
  designeePhone?: string;
  designeeFax?: string;
  designeeAddress?: string;
  /** When the responsible party signed the SS-4 and the designee block. */
  authorizedAt: string;
  /** The signed copy the filing is made from (Signara document id or a stored path). */
  signedDocumentId?: string;
  /**
   * Where that copy lives: `signara` — a document Genesis downloads on demand —
   * or `upload` (the default) — a file on Genesis's own data volume.
   */
  signedDocumentSource?: "upload" | "signara";
  /** The IRS EIN fax line the filing was sent to, once it has been. */
  toFaxNumber?: string;
  /** Zeus's id for the outbound fax, once it has been sent. */
  faxId?: string;
  faxedAt?: string;
  status: EinFilingStatus;
  note?: string;
}

export interface Business {
  id: string;
  clientId: string;
  legalName: string;
  dba?: string;
  entityType: EntityType;
  formationState: string;
  formationDate?: string;
  industry?: string;
  /** Bare domain the business wants, e.g. `acme.com`. Used by the domain step. */
  websiteDomain?: string;
  /** Preferred NANP area code for the business number, e.g. `415`. */
  phoneAreaCode?: string;
  addresses: Address[];
  people: ResponsibleParty[];
  /** Populated once the responsible party has received it from the IRS. */
  ein?: string;
  /** Populated once Dun & Bradstreet issues it. */
  duns?: string;
  /** The signed third-party-designee authorization the EIN filing is made from. */
  einFiling?: EinFiling;
  createdAt: string;
  updatedAt: string;
}

export type Phase = "entity" | "presence" | "money" | "credit";

export type ProviderKey =
  | "address"
  | "state"
  | "irs"
  | "zeus"
  | "cerulean"
  | "oasis"
  | "google"
  | "bank"
  | "magnate"
  | "dnb"
  | "experian"
  | "equifax"
  | "listings";

export type StepStatus =
  | "blocked"
  | "ready"
  | "in_progress"
  | "awaiting_human"
  | "complete"
  | "failed"
  | "skipped";

export interface StepDefinition {
  key: string;
  phase: Phase;
  title: string;
  provider: ProviderKey;
  /**
   * True when the step is completed by a person (attestation, signature, KYC),
   * not by an API call. Enforced in `policy.ts` — a step marked `requiresHuman`
   * can never be executed by an automated runner.
   */
  requiresHuman: boolean;
  dependsOn: string[];
  summary: string;
  /** Official destination a person visits to complete a human step. */
  officialUrl?: string;
  deliverables: string[];
  optional?: boolean;
}

/** A step definition plus the business-specific runtime state. */
export interface StepState {
  key: string;
  phase: Phase;
  title: string;
  provider: ProviderKey;
  requiresHuman: boolean;
  optional: boolean;
  status: StepStatus;
  /** Dependency keys that are not yet complete. */
  blockers: string[];
  detail?: string;
  evidence?: Record<string, unknown>;
  updatedAt?: string;
}
