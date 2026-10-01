import type { Business, ProviderKey } from "../types";
import { stepDefinition } from "../workflow/catalog";
import {
  assertAutomationAllowed,
  attestationFor,
  providerMode,
  PolicyError,
} from "../workflow/policy";
import type { ProviderResult, StepContext, StepProvider } from "./types";
import { HUMAN_PROVIDERS } from "./human";
import { zeusProvider } from "./zeus";
import { ceruleanProvider } from "./cerulean";
import { oasisProvider } from "./oasis";
import { magnateProvider } from "./magnate";
import { irsProvider } from "./irs";

export const PROVIDERS: Partial<Record<ProviderKey, StepProvider>> = {
  ...HUMAN_PROVIDERS,
  irs: irsProvider,
  zeus: zeusProvider,
  cerulean: ceruleanProvider,
  oasis: oasisProvider,
  magnate: magnateProvider,
};

export function providerFor(provider: ProviderKey): StepProvider | undefined {
  return PROVIDERS[provider];
}

export interface StepExecution {
  stepKey: string;
  provider: ProviderKey;
  result: ProviderResult;
}

/**
 * The one way a step is ever executed.
 *
 * It refuses to run anything the policy marks human-only, and it refuses to run
 * a step whose declaration and policy disagree — a step that claims to be
 * automated while its provider is human-attested (or the reverse) is a bug that
 * would silently let the app do something it must not, so it fails closed.
 *
 * An `assisted` step is neither: it may reach an institution, but only from the
 * responsible party's signature. So the executor does not refuse it — it hands
 * the provider the attestation and the signed copy it was given, and the
 * provider refuses to transmit without them. The policy choke point is still
 * called at the moment of transmission, inside the provider.
 */
export async function executeStep(
  business: Business,
  stepKey: string,
  env: Record<string, string | undefined>,
  fetchImpl?: typeof fetch,
  signedDocument?: { bytes: Uint8Array; filename: string },
): Promise<StepExecution> {
  const def = stepDefinition(stepKey);
  if (!def) {
    throw new PolicyError("unknown_step", `No such step: ${stepKey}`);
  }

  const provider = PROVIDERS[def.provider];
  if (!provider) {
    throw new PolicyError("no_provider", `No provider is registered for "${def.provider}".`);
  }

  const mode = providerMode(def.provider);
  if ((mode === "human") !== def.requiresHuman) {
    throw new PolicyError(
      "catalog_policy_mismatch",
      `Step "${stepKey}" declares requiresHuman=${def.requiresHuman} but provider "${def.provider}" is ${mode}.`,
    );
  }

  // Only an automated step is asserted here. A human step is not refused at
  // dispatch — its provider is the thing that *prepares* the hand-off, and it is
  // proven never to reach the network. An assisted step is left to its provider,
  // which holds the policy check at the point of transmission instead.
  if (mode === "automated") {
    assertAutomationAllowed(def.provider);
  }

  const ctx: StepContext = {
    business,
    stepKey,
    provider: def.provider,
    env,
    attestation: attestationFor(def.provider, business),
    signedDocument: mode === "assisted" ? signedDocument : undefined,
    fetchImpl,
  };

  return { stepKey, provider: def.provider, result: await provider.run(ctx) };
}
