import type { Attestation, Business, ProviderKey } from "../types";

/**
 * The provider contract.
 *
 * A provider either performs the work (the automated platforms this stack owns)
 * or prepares a hand-off for the person who must attest to it (the IRS, a bank,
 * a bureau). It never decides which of those it is — the step definition and
 * `policy.ts` do, and the registry enforces it before `run` is reached.
 */

export interface ProviderArtifact {
  name: string;
  kind: "text" | "url" | "json";
  value: string;
}

export interface ProviderResult {
  status: "complete" | "awaiting_human" | "failed";
  detail: string;
  evidence?: Record<string, unknown>;
  artifacts?: ProviderArtifact[];
  /** Where a person goes to finish a human step. */
  actionUrl?: string;
  /** Ordered instructions for a human step. */
  checklist?: string[];
}

export interface StepContext {
  business: Business;
  stepKey: string;
  provider: ProviderKey;
  env: Record<string, string | undefined>;
  /**
   * The authorization an `assisted` provider depends on, resolved by the
   * executor from the record. Absent means the party has not signed yet, and the
   * provider must prepare rather than transmit.
   */
  attestation?: Attestation;
  /**
   * The signed artifact an assisted step transmits, loaded by the caller (the
   * step route) so a provider never reaches into storage itself. Absent means the
   * signature is on record but the signed copy is not on hand — so there is
   * nothing Genesis is yet permitted to file.
   */
  signedDocument?: { bytes: Uint8Array; filename: string };
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export interface StepProvider {
  key: ProviderKey;
  run(ctx: StepContext): Promise<ProviderResult>;
}

export function requireEnv(
  env: Record<string, string | undefined>,
  name: string,
): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required configuration: ${name}`);
  }
  return value;
}

export function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
