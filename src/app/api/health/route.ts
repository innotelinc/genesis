import { json } from "@/lib/http";
import { assistedProviders, automatedProviders, policySummary } from "@/lib/workflow/policy";
import { STEP_CATALOG } from "@/lib/workflow/catalog";

export const dynamic = "force-dynamic";

/**
 * Liveness plus the facts an operator checks first: how many steps are defined,
 * which providers Genesis may automate, which it may file only from a signature,
 * and which it never touches. The policy is reported rather than assumed, so a
 * misconfiguration is visible from outside.
 */
export function GET() {
  return json({
    status: "ok",
    service: "genesis",
    classification: "BusinessOps",
    steps: STEP_CATALOG.length,
    automatedProviders: automatedProviders(),
    assistedProviders: assistedProviders(),
    humanOnlyProviders: policySummary()
      .filter((p) => p.mode === "human")
      .map((p) => p.provider),
  });
}
