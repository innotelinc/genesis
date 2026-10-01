import { trimTrailingSlash } from "./providers/types";

/**
 * Signara (SignOps) — hand a rendered packet over to be signed.
 *
 * Genesis renders a packet; Signara owns the document store, the signing
 * ceremony, the evidence trail and the signed artefact. This module does two
 * things and nothing else: upload the PDF, then open a signing request for the
 * people who must sign it.
 *
 * It is **not** a workflow step provider. Signing is an act, not a phase of the
 * launch, and the signer is always a person — Genesis routes the document, it
 * never signs and never claims a signature. That is why nothing here touches
 * `PROVIDER_POLICY`: there is no automation of a human attestation to permit.
 *
 * Contract (from Signara's OpenAPI document):
 *
 *   POST /documents/upload        multipart: file, title, description, tags?  -> Document
 *   POST /signatures/requests     JSON: { documentId, title, signers[] }      -> SigningRequest
 *
 * Auth is `X-API-Key: sgn_…` (machine-to-machine); mutating calls carry an
 * `X-Idempotency-Key`, and a repeat returns the stored response rather than
 * creating a second document.
 */

export const DEFAULT_SIGNARA_URL = "https://api.signara.innotel.us/api/v1";

export function signaraBaseUrl(env: Record<string, string | undefined>): string {
  return trimTrailingSlash(env.SIGNARA_API_URL || DEFAULT_SIGNARA_URL);
}

export function signaraConfigured(env: Record<string, string | undefined>): boolean {
  return Boolean(env.SIGNARA_API_KEY);
}

export interface SignaraSigner {
  email: string;
  name?: string;
  /** Signara's `SignerRole`, e.g. `signer`. Defaults to `signer` server-side. */
  role?: string;
  orderIndex?: number;
}

export interface SignaraDocument {
  id: string;
  title?: string;
  status?: string;
  [key: string]: unknown;
}

export interface SignaraSigningRequest {
  id: string;
  status?: string;
  [key: string]: unknown;
}

export interface SignaraHandoff {
  ok: boolean;
  status: number;
  detail: string;
  documentId?: string;
  signingRequestId?: string;
  raw?: unknown;
}

export interface SignaraHandoffInput {
  env: Record<string, string | undefined>;
  /** The rendered packet. */
  bytes: Uint8Array;
  filename: string;
  title: string;
  description: string;
  signers: SignaraSigner[];
  /** Stable per packet, so retrying does not upload twice. */
  idempotencyKey: string;
  tags?: string[];
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function failure(status: number, json: unknown, what: string): SignaraHandoff {
  const serverMessage =
    (json as { message?: string } | null)?.message ?? (json as { error?: string } | null)?.error;

  const detail =
    status === 401 || status === 403
      ? `Signara rejected the API key (check SIGNARA_API_KEY)${serverMessage ? `: ${serverMessage}` : "."}`
      : (serverMessage ?? `Signara could not ${what} (HTTP ${status}).`);

  return { ok: false, status, detail, raw: json };
}

/** Upload a rendered packet to Signara's document store. */
export async function uploadPacket(input: SignaraHandoffInput): Promise<SignaraHandoff> {
  const doFetch = input.fetchImpl ?? fetch;

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(input.bytes)], { type: "application/pdf" }), input.filename);
  form.append("title", input.title);
  form.append("description", input.description);
  for (const tag of input.tags ?? []) form.append("tags", tag);

  const res = await doFetch(`${signaraBaseUrl(input.env)}/documents/upload`, {
    method: "POST",
    headers: {
      "x-api-key": input.env.SIGNARA_API_KEY ?? "",
      "x-idempotency-key": input.idempotencyKey,
    },
    body: form,
  });
  const json = await readJson(res);

  if (!res.ok) return failure(res.status, json, "store the packet");

  const documentId = (json as SignaraDocument | null)?.id;
  if (!documentId) {
    return { ok: false, status: res.status, detail: "Signara returned no document id.", raw: json };
  }

  return {
    ok: true,
    status: res.status,
    detail: `Packet stored as ${documentId}.`,
    documentId,
    raw: json,
  };
}

/** Open a signing request for a stored document. */
export async function createSigningRequest(
  input: SignaraHandoffInput & { documentId: string },
): Promise<SignaraHandoff> {
  const doFetch = input.fetchImpl ?? fetch;

  const body = {
    documentId: input.documentId,
    title: input.title,
    message: input.description,
    sendInvites: true,
    signers: input.signers.map((signer, index) => ({
      email: signer.email,
      name: signer.name,
      role: signer.role ?? "signer",
      orderIndex: signer.orderIndex ?? index,
    })),
  };

  const res = await doFetch(`${signaraBaseUrl(input.env)}/signatures/requests`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": input.env.SIGNARA_API_KEY ?? "",
      "x-idempotency-key": `${input.idempotencyKey}:request`,
    },
    body: JSON.stringify(body),
  });
  const json = await readJson(res);

  if (!res.ok) return failure(res.status, json, "open the signing request");

  const signingRequestId = (json as SignaraSigningRequest | null)?.id;
  if (!signingRequestId) {
    return { ok: false, status: res.status, detail: "Signara returned no signing-request id.", raw: json };
  }

  return {
    ok: true,
    status: res.status,
    detail: "Signing request opened.",
    documentId: input.documentId,
    signingRequestId,
    raw: json,
  };
}

/** Upload a packet and open its signing request in one call. */
export async function sendPacketToSignara(input: SignaraHandoffInput): Promise<SignaraHandoff> {
  if (!signaraConfigured(input.env)) {
    return {
      ok: false,
      status: 0,
      detail: "Signara is not configured: set SIGNARA_API_KEY (and SIGNARA_API_URL if it is not the default).",
    };
  }

  const signers = input.signers.filter((s) => s.email && s.email.includes("@"));
  if (signers.length === 0) {
    return {
      ok: false,
      status: 0,
      detail:
        "No signer with an email address on the record — add the responsible party's email before sending the packet for signature.",
    };
  }

  const uploaded = await uploadPacket(input);
  if (!uploaded.ok || !uploaded.documentId) return uploaded;

  const request = await createSigningRequest({ ...input, signers, documentId: uploaded.documentId });
  if (!request.ok) return request;

  return {
    ok: true,
    status: request.status,
    detail: `Packet stored as ${uploaded.documentId} and sent to ${signers.length} signer${signers.length === 1 ? "" : "s"} (request ${request.signingRequestId}). The signer signs in Signara; Genesis never signs for them.`,
    documentId: uploaded.documentId,
    signingRequestId: request.signingRequestId,
    raw: { document: uploaded.raw, request: request.raw },
  };
}

// ── reading a signed document back ────────────────────────────────────────────

export interface SignaraDownload {
  ok: boolean;
  status: number;
  detail: string;
  bytes?: Uint8Array;
  filename?: string;
}

/**
 * Fetch a stored document's bytes.
 *
 * Signara's `GET /documents/:id/download` returns a **time-limited presigned
 * URL**, not the file (`{ url, fileName, contentType }`; the URL is good for 15
 * minutes). So this follows it — the presigned URL is unauthenticated and
 * short-lived, which is exactly what it is for, and the API key is never sent to
 * the storage endpoint.
 *
 * The signed SS-4 Genesis files is the *signed version* of the packet it handed
 * over. The caller passes the document id; which version is current is Signara's
 * record, not a guess Genesis makes.
 */
export async function downloadDocument(input: {
  env: Record<string, string | undefined>;
  documentId: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}): Promise<SignaraDownload> {
  if (!signaraConfigured(input.env)) {
    return {
      ok: false,
      status: 0,
      detail: "Signara is not configured: set SIGNARA_API_KEY (and SIGNARA_API_URL if it is not the default).",
    };
  }

  const doFetch = input.fetchImpl ?? fetch;

  const res = await doFetch(
    `${signaraBaseUrl(input.env)}/documents/${encodeURIComponent(input.documentId)}/download`,
    { headers: { "x-api-key": input.env.SIGNARA_API_KEY ?? "" } },
  );
  const json = await readJson(res);

  if (!res.ok) {
    const reason = failure(res.status, json, "download the document");
    return { ok: false, status: res.status, detail: reason.detail };
  }

  const url = (json as { url?: string } | null)?.url;
  if (!url) {
    return {
      ok: false,
      status: res.status,
      detail: "Signara returned no download URL for the document.",
    };
  }

  // The presigned URL carries its own authorization; no key is sent with it.
  const file = await doFetch(url);
  if (!file.ok) {
    return {
      ok: false,
      status: file.status,
      detail: `The document's download URL answered HTTP ${file.status}.`,
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const filename =
    (json as { fileName?: string } | null)?.fileName ?? `signara-${input.documentId}.pdf`;

  return {
    ok: true,
    status: res.status,
    detail: `Downloaded ${filename} (${bytes.byteLength} bytes).`,
    bytes,
    filename,
  };
}

/** The people on a business who should sign, derived from the record. */
export function signersFor(business: { people: { fullName: string; email: string; role: string }[] }): SignaraSigner[] {
  return business.people
    .filter((p) => p.email && p.email.includes("@"))
    .map((p, index) => ({ email: p.email, name: p.fullName, role: "signer", orderIndex: index }));
}
