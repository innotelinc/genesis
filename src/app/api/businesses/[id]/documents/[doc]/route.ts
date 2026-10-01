import * as store from "@/lib/store";
import { authorizeBusiness } from "@/lib/authorize";
import { notFoundJson } from "@/lib/http";
import { DOCUMENT_KEYS, type DocumentKey } from "@/lib/documents/worksheet";
import { renderPacket } from "@/lib/documents/packet";

export const dynamic = "force-dynamic";

/**
 * Every generated document, as a PDF.
 *
 * The SS-4 packet attaches the official IRS Form SS-4 when it has been fetched,
 * prefilled from the reviewed alias table (`ss4-fields.ts`), followed by
 * Genesis's worksheet. The responsible party's own fields — line 7b's SSN, the
 * signature and the designee block — are left blank by design.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; doc: string }> }) {
  const { id, doc } = await params;
  const auth = await authorizeBusiness(id);
  if (!auth.ok) return auth.response;

  if (!DOCUMENT_KEYS.includes(doc as DocumentKey)) {
    return notFoundJson(`No such document: ${doc}. Known: ${DOCUMENT_KEYS.join(", ")}.`);
  }
  const key = doc as DocumentKey;

  const packet = await renderPacket(auth.business, key);

  store.recordEvent({
    businessId: id,
    stepKey: key === "ss4" ? "ein_application" : "credit",
    actor: auth.user.email,
    kind: "document_generated",
    detail:
      key === "ss4" && packet.fill
        ? `ss4 packet generated (official form ${packet.officialState}; ${packet.fill.filled.length} prefilled, ${packet.fill.skipped.length} left to the responsible party).`
        : `${key} packet generated (official form ${packet.officialState}).`,
    evidence: packet.fill
      ? { prefilled: packet.fill.filled, leftToResponsibleParty: packet.fill.skipped }
      : undefined,
  });

  return new Response(Buffer.from(packet.bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${packet.filename}"`,
      // Observable so an operator can tell whether the official form was present
      // and whether Genesis wrote into it.
      "x-genesis-official-form": packet.officialState,
    },
  });
}
