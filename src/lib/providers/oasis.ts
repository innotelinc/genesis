import type { StepProvider, StepContext, ProviderResult } from "./types";
import { requireEnv, trimTrailingSlash } from "./types";

/**
 * Oasis (MailOps) — the business email address on its own domain.
 *
 * Oasis is a Zimbra deployment tool, not a REST service; it provisions mail with
 * `zmprov` on the mail host. So Genesis has two honest paths:
 *
 *   - when `OASIS_PROVISION_URL` is set, an operator has exposed Oasis's
 *     provisioning entry point and Genesis POSTs the mailbox request to it;
 *   - otherwise Genesis queues the request (returned as `awaiting_human`) for the
 *     Oasis operator to apply, rather than pretending the mailbox exists.
 *
 * Either way the payload is the same, so wiring the endpoint later changes
 * nothing about the request Genesis produces.
 */

export interface MailboxRequest {
  domain: string;
  mailbox: string;
  displayName: string;
  password_required: boolean;
}

function normalizeDomain(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const bare = value
    .trim()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .replace(/^www\./i, "")
    .toLowerCase();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(bare) ? bare : undefined;
}

function mailboxLocalPart(business: { legalName: string; dba?: string }): string {
  const source = business.dba?.trim() || business.legalName;
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
  return slug || "hello";
}

export function buildMailboxRequest(business: {
  legalName: string;
  dba?: string;
  websiteDomain?: string;
}): MailboxRequest | null {
  const domain = normalizeDomain(business.websiteDomain);
  if (!domain) return null;
  return {
    domain,
    mailbox: mailboxLocalPart(business),
    displayName: business.dba?.trim() || business.legalName,
    password_required: true,
  };
}

export const oasisProvider: StepProvider = {
  key: "oasis",
  async run(ctx: StepContext): Promise<ProviderResult> {
    const request = buildMailboxRequest(ctx.business);
    if (!request) {
      return {
        status: "failed",
        detail: "The domain step has not produced a usable domain yet.",
      };
    }

    const address = `${request.mailbox}@${request.domain}`;
    const provisionUrl = ctx.env.OASIS_PROVISION_URL;

    if (!provisionUrl) {
      return {
        status: "awaiting_human",
        detail: `${address} is queued for the Oasis operator — set OASIS_PROVISION_URL to apply it automatically.`,
        evidence: { queued: true, mailbox: address, request },
        artifacts: [{ name: "Business email", kind: "text", value: address }],
        checklist: [
          `On the Oasis host, create the mailbox: zmprov ca ${address} '<password>' displayName "${request.displayName}"`,
          `Confirm SPF, DKIM and DMARC for ${request.domain} (Oasis scripts/oasis-health.sh).`,
        ],
      };
    }

    const doFetch = ctx.fetchImpl ?? fetch;
    const res = await doFetch(trimTrailingSlash(requireEnv(ctx.env, "OASIS_PROVISION_URL")), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(ctx.env.OASIS_PROVISION_TOKEN
          ? { authorization: `Bearer ${ctx.env.OASIS_PROVISION_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      return {
        status: "failed",
        detail: `Oasis provisioning endpoint returned HTTP ${res.status} for ${address}.`,
      };
    }

    return {
      status: "complete",
      detail: `Oasis created ${address} on ${request.domain}.`,
      evidence: { mailbox: address, domain: request.domain },
      artifacts: [{ name: "Business email", kind: "text", value: address }],
    };
  },
};
