import { json } from "@/lib/http";
import { reachability, type ReachabilityReport } from "@/lib/integrations";

export const dynamic = "force-dynamic";

/**
 * The reachability verdict `scripts/check-integrations.mjs` produces, on the health
 * surface — so "Zeus is not answering" is visible before an owner is told their number
 * is on its way.
 *
 * Three decisions worth stating:
 *
 *  - **Cached, because this one *is* a fan-out.** `/api/health` and
 *    `/api/health/integrations` stay single cheap calls; this route deliberately reaches
 *    out to the siblings, so a monitor polling it every second must not become a
 *    distributed load test. A result younger than the TTL is reused, and a concurrent
 *    caller joins the probe already in flight rather than starting a second one.
 *  - **Always `200`.** This service is alive; a sibling being down is not Genesis being
 *    down, and a non-2xx here would have a load balancer pull a working pod. The verdict
 *    is in the body (`status: "degraded"`, `problems`), which is what an operator and a
 *    monitor both read.
 *  - **Read-only, everywhere.** The probe is `HEAD`-first and never orders a number,
 *    registers a domain, creates a mailbox, or opens a subscription. Oasis is reported as
 *    configured-but-unprobed rather than poked.
 */
const TTL_MS = 30_000;

let cached: { at: number; report: ReachabilityReport } | null = null;
let inFlight: Promise<ReachabilityReport> | null = null;

async function current(): Promise<{ report: ReachabilityReport; cached: boolean }> {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return { report: cached.report, cached: true };
  }
  // A probe already running is joined rather than duplicated.
  if (inFlight) return { report: await inFlight, cached: true };

  const run = reachability();
  inFlight = run;
  try {
    const report = await run;
    cached = { at: Date.now(), report };
    return { report, cached: false };
  } finally {
    inFlight = null;
  }
}

export async function GET() {
  const { report, cached: fromCache } = await current();
  return json({
    status: report.ok ? "ok" : "degraded",
    service: "genesis",
    ok: report.ok,
    problems: report.problems,
    checkedAt: report.checkedAt,
    cached: fromCache,
    note: "Read-only reachability across the sibling platforms. Genesis stays 200: a sibling being down is not this service being down.",
    integrations: report.integrations,
  });
}
