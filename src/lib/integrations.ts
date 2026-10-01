/**
 * The sibling-platform integrations, as one definition the CLI and the health
 * surface both read.
 *
 * These lived only inside `scripts/check-integrations.mjs`, which was fine while the
 * script was the only thing that consulted them — and wrong the moment the health
 * surface needed the same answer. A target list kept in the CLI and a second copy kept
 * in a route is two places a *contract* can drift, and the whole reason a preflight
 * exists is that a sibling platform moving is otherwise discovered by a client. So the
 * data is `integrations.json`, both sides read it, and the rationale lives here.
 *
 * Three of these five are deliberately uneven, and the unevenness is the point:
 *
 *  - **Magnate exposes no `/api/health`.** It is a Next.js storefront, so the probe is
 *    the root — a response is liveness enough, and a `404` will say so rather than being
 *    read as "the service is down".
 *  - **Oasis's entry point is a provisioning endpoint**, not a health endpoint. It is
 *    reported as *configured but not probed* rather than poked: a probe that could create
 *    a mailbox is not a probe.
 *  - **Signara's health sits outside its API prefix.** `SIGNARA_API_URL` points at
 *    `/api/v1`, and Signara's health controller deliberately excludes `/health` from that
 *    prefix, so the probe runs at the origin. Asking the versioned base verbatim would get
 *    a `404` from a healthy API.
 *
 * A probe is read-only and never changes anything anywhere: `HEAD` first, so it cannot
 * trigger work on an endpoint that treats an unexpected `GET` as a command, falling back
 * to `GET` only on `405`/`501`.
 */

import raw from "./integrations.json";

export interface IntegrationTarget {
  key: string;
  label: string;
  /** The env var holding the base URL. */
  base: string;
  /** The env var holding the credential. */
  auth: string;
  /** The health path, or `null` when this target has no endpoint worth poking. */
  health: string | null;
  purpose: string;
  /** A target a deployment may leave unset without that being a problem. */
  optional?: boolean;
  /** Probe at the base's origin rather than under its path (Signara). */
  healthOnOrigin?: boolean;
  /** A base used when the env var is unset. */
  defaultBase?: string;
}

export const INTEGRATION_TARGETS: IntegrationTarget[] = raw.targets as IntegrationTarget[];

/** One integration as this deployment has it configured. */
export interface IntegrationConfig {
  key: string;
  label: string;
  purpose: string;
  baseEnv: string;
  authEnv: string;
  /** The resolved base, or `null` when neither the env var nor a default is set. */
  base: string | null;
  /** True when every env var this integration needs is present. */
  configured: boolean;
  /** The env vars that are absent. */
  missing: string[];
  optional: boolean;
  /** The health path to probe, or `null` when there is none worth poking. */
  health: string | null;
  /** Probe at the base's origin rather than under its path (Signara). */
  healthOnOrigin: boolean;
  /** False when the target has no health endpoint to probe. */
  probeable: boolean;
}

/** What the deployment has configured, with no network access. */
export function integrationsWithConfig(env: Record<string, string | undefined> = process.env): IntegrationConfig[] {
  return INTEGRATION_TARGETS.map((target) => {
    const base = (env[target.base] ?? target.defaultBase ?? "").trim() || null;
    const missing = [target.base, target.auth].filter((name) =>
      name === target.base ? base === null : !(env[name] ?? "").trim(),
    );
    return {
      key: target.key,
      label: target.label,
      purpose: target.purpose,
      baseEnv: target.base,
      authEnv: target.auth,
      base,
      configured: missing.length === 0,
      missing,
      optional: target.optional === true,
      health: target.health,
      healthOnOrigin: target.healthOnOrigin === true,
      probeable: target.health !== null,
    };
  });
}

/* -------------------------------------------------------------------------- */
/*  The probe                                                                 */
/* -------------------------------------------------------------------------- */

export type ReachabilityVerdict =
  | "reachable"
  | "wrong-contract"
  | "unreachable"
  | "not-configured"
  | "incomplete"
  | "not-probed";

export interface IntegrationReachability {
  key: string;
  label: string;
  purpose: string;
  optional: boolean;
  verdict: ReachabilityVerdict;
  /** The HTTP status, when the probe got one. */
  status: number | null;
  /** A sentence an operator reads. */
  detail: string;
}

export interface ReachabilityReport {
  checkedAt: string;
  /** False when any integration is a problem. */
  ok: boolean;
  problems: number;
  integrations: IntegrationReachability[];
}

export interface ProbeResult {
  ok: boolean;
  status: number | null;
  error?: string;
}

/** A fetch-shaped function, injectable so the probe is tested with no socket. */
export type FetchLike = (url: string, init: { method: string; signal: AbortSignal; redirect: "manual" }) =>
  Promise<{ status: number }>;

/** The probe timeout. Short on purpose: it is a preflight, not a load test. */
export const PROBE_TIMEOUT_MS = 8000;

/**
 * Ask one base whether it answers, read-only.
 *
 * `HEAD` first so the probe cannot trigger work on an endpoint that treats an unexpected
 * `GET` as a command; a `405`/`501` says the route does not take `HEAD`, so it is retried
 * with `GET`. `redirect: "manual"` keeps the probe from following a redirect to somewhere
 * the deployment did not name.
 */
export async function probeBase(
  base: string,
  health: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<ProbeResult> {
  // A leading "/" would make `new URL` drop a base path like `/api/v1`, so join by hand.
  const url = `${base.replace(/\/+$/, "")}${health}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res = await fetchImpl(url, { method: "HEAD", signal: controller.signal, redirect: "manual" });
    if (res.status === 405 || res.status === 501) {
      res = await fetchImpl(url, { method: "GET", signal: controller.signal, redirect: "manual" });
    }
    return { ok: res.status < 400, status: res.status };
  } catch (error) {
    return { ok: false, status: null, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every integration's verdict, in one read-only pass.
 *
 * The problem count is the rule the CLI's exit code uses: a **required** integration
 * that is unset or half-configured is a problem, and an integration that answers with
 * the wrong contract or not at all is a problem whether or not it is optional — an
 * optional platform that is *down* is still something an operator wants to know, while
 * an optional one that is simply not deployed is not.
 */
export async function reachability(
  env: Record<string, string | undefined> = process.env,
  options: { fetchImpl?: FetchLike; now?: () => Date; timeoutMs?: number } = {},
): Promise<ReachabilityReport> {
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const now = options.now ?? (() => new Date());
  const configs = integrationsWithConfig(env);
  const integrations: IntegrationReachability[] = [];
  let problems = 0;

  for (const config of configs) {
    const base = {
      key: config.key,
      label: config.label,
      purpose: config.purpose,
      optional: config.optional,
      status: null as number | null,
    };

    if (config.base === null) {
      const problem = !config.optional;
      if (problem) problems += 1;
      integrations.push({
        ...base,
        verdict: "not-configured",
        detail: problem
          ? `NOT CONFIGURED — set ${config.baseEnv} and ${config.authEnv}`
          : "not configured (optional)",
      });
      continue;
    }
    if (!config.configured) {
      const problem = !config.optional;
      if (problem) problems += 1;
      integrations.push({
        ...base,
        verdict: "incomplete",
        detail: `configured, but ${config.missing.join(", ")} is empty`,
      });
      continue;
    }
    if (!config.probeable) {
      integrations.push({
        ...base,
        verdict: "not-probed",
        detail: "configured (not probed — it is a provisioning endpoint)",
      });
      continue;
    }

    // A target whose health route sits outside the API base's path (Signara) is probed
    // at the origin, not under `/api/v1`.
    let probeBaseUrl = config.base;
    if (config.healthOnOrigin) {
      try {
        probeBaseUrl = new URL(config.base).origin;
      } catch {
        probeBaseUrl = config.base;
      }
    }
    const health = config.health ?? "/";
    const result = await probeBase(probeBaseUrl, health, fetchImpl, options.timeoutMs);

    if (result.ok) {
      integrations.push({ ...base, status: result.status, verdict: "reachable", detail: `reachable (HTTP ${result.status})` });
    } else if (result.status === 404) {
      problems += 1;
      integrations.push({
        ...base,
        status: 404,
        verdict: "wrong-contract",
        detail: `reachable, but no ${health} (HTTP 404) — confirm the endpoint in docs/Integrations.md`,
      });
    } else {
      problems += 1;
      integrations.push({
        ...base,
        status: result.status,
        verdict: "unreachable",
        detail: `UNREACHABLE ${result.status ?? result.error ?? "no response"}`,
      });
    }
  }

  return { checkedAt: now().toISOString(), ok: problems === 0, problems, integrations };
}
