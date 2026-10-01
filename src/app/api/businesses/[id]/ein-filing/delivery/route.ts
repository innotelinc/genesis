import * as store from "@/lib/store";
import { authorizeBusiness } from "@/lib/authorize";
import { errorJson, json } from "@/lib/http";
import { zeusFaxStatus } from "@/lib/providers/zeus";
import { applyFaxDelivery } from "@/lib/documents/ein-filing-request";

export const dynamic = "force-dynamic";

/**
 * The EIN fax's delivery check.
 *
 * Sending is not the same as arriving. The EIN step hands the signed SS-4 to
 * Zeus, whose spool accepts the job and reports the transmission later — a fax
 * can still come back failed (no answer, busy, a wrong line), and a filing
 * recorded as done that never arrived is the one outcome this whole path exists
 * to prevent. So this is a separate, explicit read of the spool: `POST` asks Zeus
 * `GET /api/fax/[id]` and, when the answer is terminal, records it on the filing
 * (`confirmed` when every page landed, `returned` when the spool gave up).
 *
 * A `POST` rather than a `GET` because it records an outcome; the panel's `GET`
 * reads the same answer without writing anything (see the parent route).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorizeBusiness(id);
  if (!auth.ok) return auth.response;

  const filing = auth.business.einFiling;
  if (!filing?.faxId) {
    return errorJson(
      "This business has no EIN fax to check — nothing has been transmitted yet.",
      409,
    );
  }

  const env = process.env as Record<string, string | undefined>;
  const result = await zeusFaxStatus({ env }, filing.faxId);
  if (!result.ok) return errorJson(result.detail, 502);

  const checkedAt = new Date().toISOString();
  const updated = applyFaxDelivery(filing, result.state, result.detail, checkedAt, result.pages);

  // Not terminal yet: report it, change nothing. Recording `sending` as a status
  // would let a refresh erase a verdict the spool already gave.
  if (updated === filing) {
    return json({
      filing,
      delivery: { state: result.state, detail: result.detail, pages: result.pages ?? null, recorded: false },
    });
  }

  const business = store.saveEinFiling(id, updated);
  if (!business) return errorJson("No such business.", 404);

  store.recordEvent({
    businessId: id,
    stepKey: "ein_application",
    actor: auth.user.email,
    kind: updated.status === "confirmed" ? "ein_fax_delivered" : "ein_fax_failed",
    detail: result.detail,
    evidence: {
      faxId: filing.faxId,
      state: result.state,
      pages: result.pages ?? null,
      toFaxNumber: filing.toFaxNumber ?? null,
    },
  });

  return json({
    filing: business.einFiling ?? null,
    delivery: { state: result.state, detail: result.detail, pages: result.pages ?? null, recorded: true },
  });
}
