import { json } from "@/lib/http";
import { integrationsWithConfig } from "@/lib/integrations";

export const dynamic = "force-dynamic";

/**
 * Which integrations are configured, and nothing more.
 *
 * This deliberately does not probe the sibling platforms: a liveness check that reaches
 * out to five other services is a fan-out, and Oasis's entry point is a provisioning
 * endpoint that must not be poked. The reachability verdict lives at
 * `/api/health/reachability` (cached, so a monitor polling it does not hammer the
 * siblings) and in `npm run check-integrations` for a shell.
 */
export function GET() {
  const integrations = integrationsWithConfig().map((integration) => ({
    key: integration.key,
    purpose: integration.purpose,
    requires: [integration.baseEnv, integration.authEnv],
    configured: integration.configured,
    missing: integration.missing,
  }));

  return json({
    status: "ok",
    service: "genesis",
    note: "Configuration only. GET /api/health/reachability for the cached probe, or run scripts/check-integrations.mjs.",
    integrations,
  });
}
