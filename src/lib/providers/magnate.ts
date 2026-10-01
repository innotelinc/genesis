import type { StepProvider, StepContext, ProviderResult } from "./types";
import { requireEnv, trimTrailingSlash } from "./types";

/**
 * Magnate (RevenueOps) — the platform subscription.
 *
 * Billing belongs to Magnate, so Genesis never holds a payment key. When the
 * deployment exposes a subscription endpoint (`MAGNATE_SUBSCRIPTION_URL`),
 * Genesis creates the seat; otherwise it hands the operator the Magnate
 * storefront URL, since subscriptions are normally bought by the client.
 *
 * This step is optional: a client whose billing runs outside Genesis still gets
 * a complete launch.
 */

export const magnateProvider: StepProvider = {
  key: "magnate",
  async run(ctx: StepContext): Promise<ProviderResult> {
    const storefront = ctx.env.MAGNATE_URL ?? "https://magnate.innotel.us";
    const subscriptionUrl = ctx.env.MAGNATE_SUBSCRIPTION_URL;

    if (!subscriptionUrl) {
      return {
        status: "awaiting_human",
        detail: `Create the subscription in Magnate for this client (${storefront}).`,
        evidence: { storefront, plan: ctx.env.GENESIS_PLAN ?? "genesis" },
        actionUrl: storefront,
        checklist: [
          "Sign in to Magnate and create the plan for this client.",
          "Confirm the entitlements webhook reaches Genesis so paid seats gate correctly.",
        ],
      };
    }

    const doFetch = ctx.fetchImpl ?? fetch;
    const res = await doFetch(trimTrailingSlash(requireEnv(ctx.env, "MAGNATE_SUBSCRIPTION_URL")), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(ctx.env.MAGNATE_API_TOKEN
          ? { authorization: `Bearer ${ctx.env.MAGNATE_API_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        clientId: ctx.business.clientId,
        businessId: ctx.business.id,
        plan: ctx.env.GENESIS_PLAN ?? "genesis",
      }),
    });

    if (!res.ok) {
      return {
        status: "failed",
        detail: `Magnate returned HTTP ${res.status} creating the subscription.`,
      };
    }

    return {
      status: "complete",
      detail: "Magnate created the subscription and entitlements for this client.",
      evidence: { plan: ctx.env.GENESIS_PLAN ?? "genesis" },
    };
  },
};
