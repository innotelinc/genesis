import * as store from "@/lib/store";
import { authorizeBusiness } from "@/lib/authorize";
import { errorJson, json, notFoundJson } from "@/lib/http";
import { DOCUMENT_KEYS, documentPolicyNote, type DocumentKey } from "@/lib/documents/worksheet";
import { renderPacket } from "@/lib/documents/packet";
import { sendPacketToSignara, signaraConfigured, signersFor } from "@/lib/signara";

export const dynamic = "force-dynamic";

/**
 * Hand a generated packet to Signara so the owner can sign it there.
 *
 * Genesis renders the packet, uploads it and opens a signing request — it never
 * signs and never marks anything signed. A 503 means Signara is not configured;
 * the packet is still downloadable, so nothing is lost.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; doc: string }> },
) {
  const { id, doc } = await params;
  const auth = await authorizeBusiness(id);
  if (!auth.ok) return auth.response;

  if (!DOCUMENT_KEYS.includes(doc as DocumentKey)) {
    return notFoundJson(`No such document: ${doc}. Known: ${DOCUMENT_KEYS.join(", ")}.`);
  }
  const key = doc as DocumentKey;

  const env = process.env as Record<string, string | undefined>;
  if (!signaraConfigured(env)) {
    return errorJson(
      "Signara is not configured. Set SIGNARA_API_KEY (and SIGNARA_API_URL if it is not the default).",
      503,
      { code: "signara_not_configured" },
    );
  }

  const signers = signersFor(auth.business);
  if (signers.length === 0) {
    return errorJson(
      "No signer with an email address on the record. Add the responsible party's email before sending for signature.",
      409,
      { code: "no_signers" },
    );
  }

  const packet = await renderPacket(auth.business, key);

  const handoff = await sendPacketToSignara({
    env,
    bytes: packet.bytes,
    filename: packet.filename,
    title: `${auth.business.legalName} — ${key} packet`,
    description: documentPolicyNote(key),
    signers,
    tags: ["genesis", key, auth.business.id],
    idempotencyKey: `genesis-${auth.business.id}-${key}`,
  });

  if (!handoff.ok) {
    return errorJson(handoff.detail, handoff.status && handoff.status >= 400 ? 502 : 400, {
      code: "signara_failed",
      signaraStatus: handoff.status,
    });
  }

  store.recordEvent({
    businessId: id,
    stepKey: key === "ss4" ? "ein_application" : "credit",
    actor: auth.user.email,
    kind: "packet_sent_for_signature",
    detail: handoff.detail,
    evidence: {
      documentId: handoff.documentId,
      signingRequestId: handoff.signingRequestId,
      signers: signers.map((s) => s.email),
    },
  });

  return json({
    documentId: handoff.documentId,
    signingRequestId: handoff.signingRequestId,
    detail: handoff.detail,
  });
}
