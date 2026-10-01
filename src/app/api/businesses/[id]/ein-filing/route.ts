import * as store from "@/lib/store";
import { authorizeBusiness } from "@/lib/authorize";
import { errorJson, json } from "@/lib/http";
import { saveSignedSs4 } from "@/lib/documents/filing-store";
import { finalizeEinFiling, parseEinFilingForm } from "@/lib/documents/ein-filing-request";
import { fetchSigningStatus } from "@/lib/signara";

export const dynamic = "force-dynamic";

/**
 * The EIN filing panel's API.
 *
 * `POST` records the third-party-designee authorization: who is filing for the
 * business, and when the responsible party signed. The signed Form SS-4 can be
 * supplied two ways — uploaded here (stored on Genesis's data volume) or named by
 * its Signara document id, which Genesis downloads on demand at filing time.
 * Either way it is *that* document the EIN step transmits; Genesis never
 * reconstructs the form and files the reconstruction.
 *
 * Recording an authorization is not itself a filing. The EIN step still has to
 * be run, and it refuses to transmit until both the authorization and a resolvable
 * signed copy are present (see `src/lib/providers/irs.ts`).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeBusiness(id);
  if (!auth.ok) return auth.response;

  const filing = auth.business.einFiling;

  // The signing request's state is read live rather than cached: it is the one
  // fact that changes without Genesis doing anything, and a stale "awaiting
  // signature" is exactly the wrong thing to show on a filing about to be sent.
  const signing = filing?.signingRequestId
    ? await fetchSigningStatus({
        env: process.env as Record<string, string | undefined>,
        requestId: filing.signingRequestId,
      })
    : null;

  return json({
    filing: filing ?? null,
    signing: signing
      ? { state: signing.state, detail: signing.detail, rawStatus: signing.rawStatus ?? null }
      : null,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeBusiness(id);
  if (!auth.ok) return auth.response;

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return errorJson("Content-Type must be multipart/form-data.", 400);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorJson("Invalid form data.", 400);
  }

  const parsed = await parseEinFilingForm(form);
  if (!parsed.ok) return errorJson(parsed.error, 400);

  // Where the signed copy lives. An uploaded file wins over a Signara id, because
  // it is the copy the operator just handed over.
  let signed: { id: string; source: "upload" | "signara" } | undefined;
  if (parsed.file) {
    signed = { id: await saveSignedSs4(id, parsed.file.bytes, process.env), source: "upload" };
  } else if (parsed.fields.signaraDocumentId) {
    signed = { id: parsed.fields.signaraDocumentId, source: "signara" };
  }

  const filing = finalizeEinFiling(parsed.fields, auth.business.einFiling, signed);

  const business = store.saveEinFiling(id, filing);
  if (!business) return errorJson("No such business.", 404);

  store.recordEvent({
    businessId: id,
    stepKey: "ein_application",
    actor: auth.user.email,
    kind: "ein_authorization_recorded",
    detail: signed
      ? `Third-party designee ${filing.designeeName} authorized; signed SS-4 via ${signed.source}.`
      : `Third-party designee ${filing.designeeName} authorized (signed SS-4 not yet on file).`,
    evidence: { authorizedAt: filing.authorizedAt, signedDocumentId: filing.signedDocumentId ?? null, source: filing.signedDocumentSource ?? null },
  });

  return json({ filing: business.einFiling ?? null }, 201);
}
