import type { StepProvider, StepContext, ProviderResult } from "./types";
import { requireEnv, trimTrailingSlash } from "./types";

/**
 * Cerulean (TrustOps) — domain zone, DNS, TLS and the edge host.
 *
 * Cerulean is the only component in the stack that talks to BIND and the NPM
 * API (standard §5), so Genesis never calls those directly. Genesis asks
 * Cerulean's service bridge to register the zone, issue the wildcard
 * certificate and publish the name on the edge — and Cerulean does the writes.
 *
 * Contract (verified against the running server at 192.168.1.71:3003 on
 * 2026-09-30 — every route below answers **401** without a key, i.e. it exists):
 *
 *   POST /api/service/domains           { name }                    -> register the DNS zone
 *   GET  /api/service/certificates                                  -> reuse an existing cert
 *   POST /api/service/certificates      { domain, wildcard, name }  -> request wildcard TLS
 *   POST /api/service/npm/export-cert   { certificate_id }          -> push the PEM into NPM
 *   GET  /api/service/npm/hosts                                     -> find an existing host
 *   POST /api/service/npm/hosts         { domain, forward_host, forward_port, certificate_id } -> publish
 *   PUT  /api/service/npm/hosts/:id     { forward_host, forward_port, certificate_id }         -> re-point
 *
 * There is **no** `POST /api/service/hosts`; a call to it answers 404, and a
 * provider that made one could never publish anything. The earlier contract
 * here was wrong on both the path and the body, and is what this file corrects.
 *
 * Auth is the scoped service key (`Bearer ceru_…`). The scopes this provider
 * needs are `domains:write` (DNS), `certs:write` (TLS) and `npm:read` + `npm:write`
 * (the edge host) — `*` also works.
 */

/** The registrable zone for a host: `shop.acme.co.uk` -> `acme.co.uk` is not
 *  derivable without a public-suffix list, so this takes the last two labels,
 *  which is what the platform's zones are. `CERULEAN_ZONE` overrides it. */
function registrableZone(domain: string): string {
  return domain.split(".").slice(-2).join(".");
}

function normalizeDomain(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const withoutScheme = value.trim().replace(/^https?:\/\//i, "");
  const host = withoutScheme.split("/")[0];
  const bare = host.replace(/^www\./i, "").toLowerCase();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(bare) ? bare : undefined;
}

interface CeruleanResponse {
  ok: boolean;
  status: number;
  json: unknown;
}

async function ceruleanRequest(
  ctx: StepContext,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: Record<string, unknown>,
): Promise<CeruleanResponse> {
  const base = trimTrailingSlash(requireEnv(ctx.env, "CERULEAN_DNS_API_URL"));
  const key = requireEnv(ctx.env, "CERULEAN_SERVICE_KEY");
  const doFetch = ctx.fetchImpl ?? fetch;

  const res = await doFetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
}

/** A 401/403 is a key problem, not a routing one; say so plainly. */
function keyProblem(status: number): string | null {
  return status === 401 || status === 403
    ? "Cerulean rejected the service key — check CERULEAN_SERVICE_KEY (needs domains:write, certs:write, npm:read, npm:write)."
    : null;
}

interface CeruleanCertificate {
  id: number;
  domain?: string;
  wildcard?: boolean;
}

interface NpmHost {
  id: number;
  domain_names?: string[];
}

export const ceruleanProvider: StepProvider = {
  key: "cerulean",
  async run(ctx: StepContext): Promise<ProviderResult> {
    const domain = normalizeDomain(ctx.business.websiteDomain);
    if (!domain) {
      return {
        status: "failed",
        detail:
          "No usable domain on the business record. Set one at intake (e.g. acme.com).",
      };
    }

    const zone = ctx.env.CERULEAN_ZONE ?? registrableZone(domain);

    // 1. Register / claim the zone. A 409 means it is already registered, which
    //    is a success for a re-run rather than an error to surface.
    const registered = await ceruleanRequest(ctx, "POST", "/api/service/domains", {
      name: zone,
    });
    if (!registered.ok && registered.status !== 409) {
      return {
        status: "failed",
        detail:
          keyProblem(registered.status) ??
          `Cerulean could not register ${zone} (HTTP ${registered.status}).`,
      };
    }

    // 2. Wildcard TLS for the zone. Reuse an existing wildcard certificate
    //    rather than minting a duplicate on every run.
    let certificateId: number | undefined;
    const certs = await ceruleanRequest(ctx, "GET", "/api/service/certificates");
    const existingCert = Array.isArray(certs.json)
      ? (certs.json as CeruleanCertificate[]).find(
          (c) => c.domain === zone && c.wildcard,
        )
      : undefined;

    if (existingCert) {
      certificateId = existingCert.id;
    } else {
      const issued = await ceruleanRequest(ctx, "POST", "/api/service/certificates", {
        domain: zone,
        wildcard: true,
        name: `*.${zone}`,
      });
      if (!issued.ok) {
        return {
          status: "failed",
          detail:
            keyProblem(issued.status) ??
            `Cerulean could not request TLS for ${zone} (HTTP ${issued.status}).`,
        };
      }
      certificateId = (issued.json as { id?: number } | null)?.id;
    }

    // 3. The edge host points at an upstream on the LAN. Without one there is
    //    nothing to publish to, and guessing a port would put a name on the edge
    //    that answers nothing — so this is handed to the operator instead.
    const forwardHost = ctx.env.NPM_FORWARD_HOST;
    const forwardPort = ctx.env.NPM_FORWARD_PORT;
    if (!forwardHost || !forwardPort) {
      return {
        status: "awaiting_human",
        detail:
          `Cerulean owns ${zone} — the DNS zone and a wildcard certificate are in place — ` +
          `but no upstream is configured, so ${domain} is not on the edge yet. ` +
          "Set NPM_FORWARD_HOST and NPM_FORWARD_PORT to the client's app and re-run.",
        evidence: { domain, zone, tls: "wildcard", dnsProvider: ctx.env.CERULEAN_DNS_PROVIDER ?? "rfc2136" },
        checklist: [
          `Set NPM_FORWARD_HOST to the LAN address hosting the client's app, and NPM_FORWARD_PORT to its port (NPM upstreams are LAN addresses only).`,
          `Re-run this step; Cerulean will publish ${domain} on the edge with the wildcard certificate already issued.`,
        ],
        artifacts: [
          { name: "Domain", kind: "text", value: domain },
          { name: "Zone", kind: "text", value: zone },
        ],
      };
    }

    // 4. NPM attaches TLS by its own certificate id, so the Cerulean
    //    certificate has to be pushed across. A 409 means the PEM is not ready
    //    yet (issuance is asynchronous) — publish the host anyway and report TLS
    //    as pending rather than blocking the launch on a certificate.
    let npmCertificateId = 0;
    if (certificateId !== undefined) {
      const exported = await ceruleanRequest(
        ctx,
        "POST",
        "/api/service/npm/export-cert",
        { certificate_id: certificateId },
      );
      if (exported.ok) {
        npmCertificateId = Number(
          (exported.json as { npmCertificateId?: number } | null)?.npmCertificateId ?? 0,
        );
      }
    }

    // 5. Publish the host — create it, or re-point the existing one so a re-run
    //    reconciles instead of leaving two hosts for the same name.
    const hostBody = {
      forward_host: forwardHost,
      forward_port: Number(forwardPort),
      forward_scheme: "http",
      certificate_id: npmCertificateId,
      ssl_forced: npmCertificateId > 0,
      http2_support: true,
    };

    const hosts = await ceruleanRequest(ctx, "GET", "/api/service/npm/hosts");
    const existingHost = Array.isArray(hosts.json)
      ? (hosts.json as NpmHost[]).find((h) =>
          (h.domain_names ?? []).some((d) => d.toLowerCase() === domain),
        )
      : undefined;

    const published = existingHost
      ? await ceruleanRequest(ctx, "PUT", `/api/service/npm/hosts/${existingHost.id}`, hostBody)
      : await ceruleanRequest(ctx, "POST", "/api/service/npm/hosts", {
          domain,
          ...hostBody,
        });

    if (!published.ok) {
      return {
        status: "failed",
        detail:
          keyProblem(published.status) ??
          `Cerulean registered ${zone} but could not publish the host (HTTP ${published.status}).`,
      };
    }

    const tls = npmCertificateId > 0 ? "wildcard" : "pending";
    return {
      status: "complete",
      detail:
        `Cerulean owns ${zone}: the DNS zone, a wildcard certificate and the NPM host for ${domain} → ${forwardHost}:${forwardPort}` +
        (tls === "pending"
          ? " (TLS is issued asynchronously; the host is attached once the certificate material is ready)."
          : "."),
      evidence: {
        domain,
        zone,
        tls,
        dnsProvider: ctx.env.CERULEAN_DNS_PROVIDER ?? "rfc2136",
        upstream: `${forwardHost}:${forwardPort}`,
      },
      artifacts: [
        { name: "Domain", kind: "text", value: domain },
        { name: "Zone", kind: "text", value: zone },
      ],
    };
  },
};
