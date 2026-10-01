import type { EinFiling, EinFilingStatus } from "../types";

/**
 * The EIN filing request — parsed and merged away from HTTP.
 *
 * The route handler is thin on purpose: it authenticates, calls these two pure
 * functions and stores the result. Everything that can be wrong about the input
 * (a missing designee, a bad date, an oversized or non-PDF signed copy, an
 * authorization that would silently drop a fax already sent) is decided here, so
 * it is unit-testable without a request, a database or a Next.js runtime.
 */

/** The IRS fax ceiling, and Zeus's own. */
export const MAX_SS4_BYTES = 10 * 1024 * 1024;

export interface EinFilingFields {
  designeeName: string;
  designeePhone?: string;
  designeeFax?: string;
  designeeAddress?: string;
  authorizedAt: string;
  note?: string;
  /** A Signara document id, when the signed copy is held there rather than uploaded. */
  signaraDocumentId?: string;
}

export interface EinFilingFile {
  bytes: Uint8Array;
  filename: string;
}

export type ParseResult =
  | { ok: true; fields: EinFilingFields; file?: EinFilingFile; error?: never }
  | { ok: false; error: string; fields?: never; file?: never };

function text(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Validate one multipart body into the fields an authorization needs, plus the
 * signed copy's bytes when one was attached.
 *
 * `now` is injected so the default timestamp is deterministic in tests.
 */
export async function parseEinFilingForm(
  form: FormData,
  now: () => string = () => new Date().toISOString(),
): Promise<ParseResult> {
  const designeeName = text(form, "designeeName");
  if (!designeeName) {
    return {
      ok: false,
      error:
        "The designee's name is required — it is what the responsible party authorized on the SS-4.",
    };
  }

  const authorizedAt = text(form, "authorizedAt") ?? now();
  if (Number.isNaN(Date.parse(authorizedAt))) {
    return { ok: false, error: "authorizedAt must be an ISO date-time." };
  }

  const fields: EinFilingFields = {
    designeeName,
    designeePhone: text(form, "designeePhone"),
    designeeFax: text(form, "designeeFax"),
    designeeAddress: text(form, "designeeAddress"),
    authorizedAt,
    note: text(form, "note"),
    signaraDocumentId: text(form, "signaraDocumentId"),
  };

  const raw = form.get("file");
  if (raw instanceof File && raw.size > 0) {
    if (raw.type && raw.type !== "application/pdf" && !raw.name.toLowerCase().endsWith(".pdf")) {
      return { ok: false, error: "The signed SS-4 must be a PDF." };
    }
    if (raw.size > MAX_SS4_BYTES) {
      return { ok: false, error: "The signed SS-4 must be under 10 MB." };
    }
    const bytes = new Uint8Array(await raw.arrayBuffer());
    return { ok: true, fields, file: { bytes, filename: raw.name || "ss4-signed.pdf" } };
  }

  return { ok: true, fields };
}

/**
 * Merge the submitted fields with what is already recorded.
 *
 * Only the authorization is rewritten. A transmission that already happened —
 * the fax id and the line it went to — is carried forward, because losing it
 * would let a filed EIN be run again as if nothing had been sent.
 */
export function finalizeEinFiling(
  fields: EinFilingFields,
  previous: EinFiling | undefined,
  signed: { id: string; source: "upload" | "signara" } | undefined,
): EinFiling {
  const status: EinFilingStatus = previous?.faxId ? "faxed" : "authorized";

  return {
    designeeName: fields.designeeName,
    designeePhone: fields.designeePhone,
    designeeFax: fields.designeeFax,
    designeeAddress: fields.designeeAddress,
    authorizedAt: fields.authorizedAt,
    signedDocumentId: signed?.id ?? previous?.signedDocumentId,
    signedDocumentSource: signed?.source ?? previous?.signedDocumentSource,
    toFaxNumber: previous?.toFaxNumber,
    faxId: previous?.faxId,
    faxedAt: previous?.faxedAt,
    status,
    note: fields.note,
  };
}
