import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Which integrations are configured, and nothing more.
 *
 * This deliberately does not probe the sibling platforms: a health endpoint that
 * reaches out to five other services turns a liveness check into a fan-out, and
 * Oasis's entry point is a provisioning endpoint that must not be poked. Run
 * `node scripts/check-integrations.mjs` for the read-only reachability probe.
 */
export function GET() {
  const integrations = [
    {
      key: "zeus",
      purpose: "Order the business phone number",
      requires: ["ZEUS_API_URL", "ZEUS_API_TOKEN"],
    },
    {
      key: "cerulean",
      purpose: "Register the domain zone, wildcard TLS and proxy host",
      requires: ["CERULEAN_DNS_API_URL", "CERULEAN_SERVICE_KEY"],
    },
    {
      key: "oasis",
      purpose: "Create the business mailbox (queued when unset)",
      requires: ["OASIS_PROVISION_URL"],
    },
    {
      key: "magnate",
      purpose: "Create the client's subscription",
      requires: ["MAGNATE_URL"],
    },
    {
      key: "signara",
      purpose: "Hand a generated packet over to be signed (optional)",
      requires: ["SIGNARA_API_KEY"],
    },
  ].map((integration) => ({
    ...integration,
    configured: integration.requires.every((name) => Boolean(process.env[name])),
    missing: integration.requires.filter((name) => !process.env[name]),
  }));

  return json({
    status: "ok",
    service: "genesis",
    note: "Configuration only. Run scripts/check-integrations.mjs to probe reachability (read-only).",
    integrations,
  });
}
