import type { StepProvider, StepContext, ProviderResult } from "./types";
import { requireEnv, trimTrailingSlash } from "./types";
import { principalAddress } from "../workflow/policy";

/**
 * Zeus (VoiceOps) — business phone number.
 *
 * Genesis does not talk to the carrier. Zeus owns number provisioning and
 * exposes it on `POST /api/phone/numbers` with `action=search|order`; Genesis
 * asks Zeus for a number and Zeus provisions it on FreePBX/VoIP.ms.
 *
 * A machine client authenticates with a service token rather than a user
 * session: the token maps to the platform's tenant account in Zeus, which owns
 * the number on the business's behalf.
 */

interface ZeusNumber {
  did?: string;
  areacode?: string;
  server?: string;
}

async function zeusPost(
  ctx: StepContext,
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const base = trimTrailingSlash(requireEnv(ctx.env, "ZEUS_API_URL"));
  const token = requireEnv(ctx.env, "ZEUS_API_TOKEN");
  const doFetch = ctx.fetchImpl ?? fetch;

  const res = await doFetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
}

function bearerError(status: number): string {
  if (status === 401 || status === 403) {
    return "Zeus rejected the service token (check ZEUS_API_TOKEN and its account's permissions).";
  }
  return `Zeus returned HTTP ${status}.`;
}

// ── fax ───────────────────────────────────────────────────────────────────────

export interface ZeusFaxInput {
  /** Destination fax number, E.164 or the dialable form. */
  toFaxNumber: string;
  /** Id of the account's source DID (`from_did_id`) on Zeus. */
  fromDidId: string;
  /** The document to transmit — Genesis sends a PDF. */
  pdf: Uint8Array;
  filename: string;
  subject?: string;
  /** Optional ISO time; a future value queues the fax instead of sending now. */
  scheduledAt?: string;
}

export interface ZeusFaxResult {
  ok: boolean;
  status: number;
  detail: string;
  faxId?: string;
}

/**
 * Send a fax through Zeus (VoiceOps).
 *
 * Zeus owns AvantFax/HylaFAX+ and the fax numbers; Genesis never talks to a fax
 * carrier. This is `POST /api/fax/send`, multipart, exactly as the portal's own
 * fax screen uses it, and the signed document is the `file` part — Genesis hands
 * over the bytes it was given and nothing re-renders them on the way.
 */
export async function zeusSendFax(ctx: StepContext, input: ZeusFaxInput): Promise<ZeusFaxResult> {
  const base = trimTrailingSlash(requireEnv(ctx.env, "ZEUS_API_URL"));
  const token = requireEnv(ctx.env, "ZEUS_API_TOKEN");
  const doFetch = ctx.fetchImpl ?? fetch;

  const form = new FormData();
  form.append("to_number", input.toFaxNumber);
  form.append("from_did_id", input.fromDidId);
  if (input.subject) form.append("subject", input.subject);
  if (input.scheduledAt) form.append("scheduled_at", input.scheduledAt);
  form.append(
    "file",
    new Blob([new Uint8Array(input.pdf)], { type: "application/pdf" }),
    input.filename,
  );

  const res = await doFetch(`${base}/api/fax/send`, {
    method: "POST",
    // No content-type header: fetch sets the multipart boundary itself.
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    const serverMessage =
      (json as { error?: string } | null)?.error ?? null;
    return {
      ok: false,
      status: res.status,
      detail: serverMessage
        ? `Zeus refused the fax: ${serverMessage}`
        : bearerError(res.status),
    };
  }

  const body = json as { fax?: { id?: string }; sent?: boolean } | null;
  const faxId = body?.fax?.id;

  // A 2xx with no fax id is not a filing we can point at. Reporting it as one
  // would let a filing be marked sent with nothing to trace it by.
  if (!faxId) {
    return {
      ok: false,
      status: res.status,
      detail: "Zeus accepted the request but returned no fax id, so the filing cannot be traced.",
    };
  }

  return {
    ok: true,
    status: res.status,
    detail: `Zeus queued fax ${faxId}${body?.sent === false ? " (deferred — not yet sent by AvantFax)" : ""}.`,
    faxId,
  };
}

export const zeusProvider: StepProvider = {
  key: "zeus",
  async run(ctx: StepContext): Promise<ProviderResult> {
    const principal = principalAddress(ctx.business);
    const areaCode = ctx.business.phoneAreaCode;

    if (!areaCode && !principal) {
      return {
        status: "failed",
        detail:
          "No area code and no principal address on record — Genesis cannot pick a number region. Add one at intake.",
      };
    }

    // 1. Find a number in the requested region.
    const search = await zeusPost(ctx, "/api/phone/numbers", {
      action: "search",
      areacode: areaCode,
      state: principal?.state,
    });

    if (!search.ok) {
      return { status: "failed", detail: bearerError(search.status) };
    }

    const candidates = Array.isArray(search.json)
      ? (search.json as ZeusNumber[])
      : ((search.json as { numbers?: ZeusNumber[] })?.numbers ?? []);

    const pick = candidates.find((n) => n.did);
    if (!pick?.did) {
      return {
        status: "failed",
        detail: `Zeus found no available numbers for area code ${areaCode ?? "(unspecified)"}.`,
      };
    }

    // 2. Order it. Zeus enables SMS on the DID as part of ordering.
    const order = await zeusPost(ctx, "/api/phone/numbers", {
      action: "order",
      did: pick.did,
      areacode: pick.areacode ?? areaCode,
      server: pick.server,
    });

    if (!order.ok) {
      const detail =
        (order.json as { error?: string } | null)?.error ?? bearerError(order.status);
      return { status: "failed", detail: `Zeus refused the order: ${detail}` };
    }

    return {
      status: "complete",
      detail: `Zeus provisioned ${pick.did} and bound an extension to it.`,
      evidence: { did: pick.did, areacode: pick.areacode ?? areaCode ?? null },
      artifacts: [{ name: "Business number", kind: "text", value: pick.did }],
    };
  },
};
