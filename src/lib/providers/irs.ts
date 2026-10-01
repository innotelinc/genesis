import type { ProviderResult, StepContext, StepProvider } from "./types";
import { requireEnv } from "./types";
import { buildSs4, renderSs4Text, ss4Filename, ss4Missing } from "../documents/ss4";
import {
  authorizationChecklist,
  IRS_EIN_ONLINE_URL,
  resolveEinFaxNumber,
} from "../documents/filing";
import { assertAutomationAllowed } from "../workflow/policy";
import { zeusSendFax } from "./zeus";

/**
 * IRS — the EIN application, filed as third-party designee.
 *
 * This is the one *assisted* provider: it may reach an institution, but only
 * through an act the responsible party performed first. The two refusals are the
 * whole design:
 *
 *   1. without a recorded signature (`attestation`), it prepares and stops — the
 *      packet, the checklist, the IRS destination, no network call;
 *   2. with a signature but no signed copy on hand, it stops again — Genesis will
 *      not reconstruct the form and file that, because the thing filed has to be
 *      the thing that was signed.
 *
 * Only when both are present does it fax, and at that moment it calls the policy
 * choke point (`assertAutomationAllowed` with the attestation) as defence in
 * depth, exactly where the transmission happens.
 */
export const irsProvider: StepProvider = {
  key: "irs",
  async run(ctx: StepContext): Promise<ProviderResult> {
    const fields = buildSs4(ctx.business);
    const missing = ss4Missing(fields);
    const filing = ctx.business.einFiling;

    // ── 1. Not yet authorized: prepare and hand the party their checklist. ──
    if (!ctx.attestation) {
      return {
        status: "awaiting_human",
        detail:
          "Form SS-4 is prepared. The responsible party reviews and signs it — naming Genesis as third-party designee — and Genesis files it once that signature is on record.",
        actionUrl: IRS_EIN_ONLINE_URL,
        evidence: {
          stage: filing ? "signature_outstanding" : "awaiting_authorization",
          missingLines: missing,
          missingCount: missing.length,
        },
        artifacts: [
          {
            name: ss4Filename(ctx.business),
            kind: "text",
            value: renderSs4Text(ctx.business),
          },
        ],
        checklist: [
          ...(missing.length > 0
            ? [
                `Complete the ${missing.length} line(s) Genesis cannot supply: ${missing.join("; ")}.`,
              ]
            : ["Every line Genesis can fill is filled."]),
          ...authorizationChecklist(ctx.business),
        ],
      };
    }

    // ── 2. Authorized, but the signed copy is not on hand. ──────────────────
    const signed = ctx.signedDocument;
    if (!signed) {
      return {
        status: "awaiting_human",
        detail:
          "The authorization is recorded, but the signed SS-4 is not on file — upload the signed copy so Genesis transmits exactly what the party signed.",
        evidence: {
          stage: "awaiting_signed_form",
          authorizedAt: ctx.attestation.authorizedAt,
        },
        artifacts: [
          {
            name: ss4Filename(ctx.business),
            kind: "text",
            value: renderSs4Text(ctx.business),
          },
        ],
        checklist: [
          "Upload the signed Form SS-4 (PDF) on the EIN filing panel, or send it through Signara.",
          "Genesis will not re-render the form and file that — the filed copy is the signed copy.",
        ],
      };
    }

    // ── 3. Where the filing goes. Configuration, never guessed. ─────────────
    const toFaxNumber = resolveEinFaxNumber(ctx.business, ctx.env);
    if (!toFaxNumber) {
      return {
        status: "failed",
        detail:
          "No IRS EIN fax line is configured. Set IRS_EIN_FAX_NUMBER (or IRS_EIN_FAX_BY_STATE) from the SS-4 instructions before filing.",
      };
    }

    // The choke point, at the moment of transmission — not merely at dispatch.
    assertAutomationAllowed("irs", ctx.attestation);

    const sent = await zeusSendFax(ctx, {
      toFaxNumber,
      fromDidId: requireEnv(ctx.env, "ZEUS_FAX_FROM_DID_ID"),
      pdf: signed.bytes,
      filename: signed.filename,
      subject: `Form SS-4 — ${ctx.business.legalName}`,
    });

    if (!sent.ok) {
      return { status: "failed", detail: sent.detail };
    }

    return {
      status: "complete",
      detail: `Genesis faxed the signed SS-4 to the IRS EIN line (${toFaxNumber}) as third-party designee. ${sent.detail}`,
      evidence: {
        stage: "faxed",
        faxId: sent.faxId ?? null,
        toFaxNumber,
        authorizedAt: ctx.attestation.authorizedAt,
        signedDocument: signed.filename,
      },
      checklist: [
        "The IRS returns the EIN by fax when the responsible party asked for it there; otherwise expect CP 575 by mail in about four weeks.",
        "Record the EIN on the business once it is issued — the banking, bureau and listing steps all depend on it.",
      ],
    };
  },
};
